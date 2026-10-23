import { DISCONNECT_GRACE_MS } from "./game.types.ts";

const helpers = `
local function fail(code) return redis.error_reply(code) end
local function snapshot() return redis.call('HGETALL', KEYS[1]) end
local function field(name) return redis.call('HGET', KEYS[1], name) end
local function number(name) return tonumber(field(name)) end
local function deadline(id)
  if field('status') == 'active' then
    local clock = field('turn') == 'w' and 'white_time_ms' or 'black_time_ms'
    local due = number('last_move_at') + number(clock) + number('lag_allowance_ms')
    for _, name in ipairs({'white_disconnected_at', 'black_disconnected_at'}) do
      local disconnected = number(name)
      if disconnected then due = math.min(due, disconnected + ${DISCONNECT_GRACE_MS}) end
    end
    redis.call('ZADD', KEYS[4], due, id)
    redis.call('ZREM', KEYS[5], id)
  elseif field('status') == 'completed' then
    redis.call('ZREM', KEYS[4], id)
    redis.call('ZADD', KEYS[5], number('ended_at'), id)
  end
end
`;

export const activateScript =
  helpers +
  `
if redis.call('EXISTS', KEYS[1]) == 0 then return fail('GAME_MISSING') end
if field('white_id') ~= ARGV[2] or field('black_id') ~= ARGV[3] or ARGV[2] == ARGV[3] then
  return fail('GAME_FORBIDDEN')
end
if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('GET', KEYS[3]) ~= ARGV[1] then
  return fail('GAME_INVALID_STATE')
end
if field('status') == 'active' or field('status') == 'completed' then
  deadline(ARGV[1])
  redis.call('ZREM', KEYS[6], ARGV[1])
  return snapshot()
end
if field('status') ~= 'waiting' or number('move_count') ~= 0 or field('turn') ~= 'w' then
  return fail('GAME_INVALID_STATE')
end
if number('white_time_ms') ~= 600000 or number('black_time_ms') ~= 600000 then
  return fail('GAME_INVALID_STATE')
end
redis.call('HSET', KEYS[1], 'status', 'active', 'started_at', ARGV[4],
  'last_move_at', ARGV[4], 'lag_allowance_ms', ARGV[5], 'version', 1, 'move_records', '[]')
redis.call('PERSIST', KEYS[1])
redis.call('EXPIRE', KEYS[2], 86400)
redis.call('EXPIRE', KEYS[3], 86400)
deadline(ARGV[1])
redis.call('ZREM', KEYS[6], ARGV[1])
return snapshot()
`;

export const scheduleScript =
  helpers +
  `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
if field('white_id') ~= ARGV[2] or field('black_id') ~= ARGV[3] then return fail('GAME_FORBIDDEN') end
deadline(ARGV[1])
return 1
`;

export const cleanupScript = `
-- PostgreSQL has confirmed this game is terminal; corrupted hash metadata must not prevent cleanup.
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('ZREM', KEYS[5], ARGV[1])
redis.call('ZREM', KEYS[6], ARGV[1])
redis.call('DEL', KEYS[1])
return 1
`;

export const mutateScript =
  helpers +
  `
if redis.call('EXISTS', KEYS[1]) == 0 then return fail('GAME_MISSING') end
if field('white_id') ~= ARGV[3] or field('black_id') ~= ARGV[4] then return fail('GAME_FORBIDDEN') end
local m = cjson.decode(ARGV[5])
if m.actorId and m.actorId ~= ARGV[3] and m.actorId ~= ARGV[4] then return fail('GAME_FORBIDDEN') end
if field('status') == 'completed' then return snapshot() end
if tonumber(field('version') or '0') ~= tonumber(ARGV[2]) then return fail('GAME_CONFLICT') end
if field('status') ~= 'active' then return fail('GAME_NOT_ACTIVE') end
if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('GET', KEYS[3]) ~= ARGV[1] then
  return fail('GAME_INVALID_STATE')
end
local turn = field('turn')
local clock = turn == 'w' and 'white_time_ms' or 'black_time_ms'
local at = math.max(m.at, number('last_move_at'))
local elapsed = at - number('last_move_at')
local remaining = number(clock) - math.max(0, elapsed - number('lag_allowance_ms'))
local outcome = nil
local disconnected = m.actorId == ARGV[3] and 'white_disconnected_at' or 'black_disconnected_at'
if remaining <= 0 then
  remaining = 0
  outcome = { result = m.timeoutResult, reason = 'timeout' }
elseif m.kind == 'timeout' then
  return snapshot()
elseif m.kind == 'disconnect' and field(disconnected) then
  deadline(ARGV[1])
  return snapshot()
elseif m.kind == 'reconnect' and not field(disconnected) then
  return snapshot()
elseif m.kind == 'abandon' then
  if not number(disconnected) or m.at < number(disconnected) + ${DISCONNECT_GRACE_MS} then
    return fail('GAME_GRACE_ACTIVE')
  end
  local other = m.actorId == ARGV[3] and 'black_disconnected_at' or 'white_disconnected_at'
  local result = m.actorId == ARGV[3] and 'black_win' or 'white_win'
  if number(other) == number(disconnected) then result = 'draw' end
  outcome = { result = result, reason = 'abandonment' }
elseif m.kind == 'move' then
  local mover = turn == 'w' and ARGV[3] or ARGV[4]
  if m.actorId ~= mover or m.move.color ~= turn or m.move.turn == turn then return fail('GAME_FORBIDDEN') end
  outcome = m.move.outcome
elseif m.kind == 'finish' then
  if m.outcome.reason == 'draw_agreement' and
    (not field('draw_offered_by') or field('draw_offered_by') == m.actorId) then return fail('GAME_DRAW_MISSING') end
  outcome = m.outcome
elseif m.kind == 'offer' and field('draw_offered_by') then
  return fail('GAME_DRAW_PENDING')
elseif m.kind == 'decline' and
  (not field('draw_offered_by') or field('draw_offered_by') == m.actorId) then
  return fail('GAME_DRAW_MISSING')
end
if m.kind == 'move' and remaining > 0 then
  local records = cjson.decode(field('move_records'))
  local move = m.move
  remaining = remaining + number('increment_ms')
  local record = { from = move.from, to = move.to, san = move.san, uci = move.uci,
    fenAfter = move.fenAfter, color = move.color, playedAt = at, timeRemainingMs = remaining }
  if move.promotion then record.promotion = move.promotion end
  records[#records + 1] = record
  local serialized = cjson.encode(records)
  redis.call('HSET', KEYS[1], 'fen', move.fenAfter, 'turn', move.turn,
    'last_move_at', at, 'move_records', serialized, 'lag_allowance_ms', m.nextLagMs or 0)
  redis.call('HINCRBY', KEYS[1], 'move_count', 1)
  if field('draw_offered_by') ~= m.actorId then redis.call('HDEL', KEYS[1], 'draw_offered_by') end
elseif m.kind == 'offer' and not outcome then
  redis.call('HSET', KEYS[1], 'draw_offered_by', m.actorId)
elseif m.kind == 'decline' and not outcome then
  redis.call('HDEL', KEYS[1], 'draw_offered_by')
elseif m.kind == 'disconnect' and not outcome then
  redis.call('HSET', KEYS[1], disconnected, m.at)
elseif m.kind == 'reconnect' and not outcome then
  redis.call('HDEL', KEYS[1], disconnected)
end
if m.kind == 'move' or outcome then redis.call('HSET', KEYS[1], clock, remaining) end
if outcome then
  redis.call('HSET', KEYS[1], 'status', 'completed', 'result', outcome.result,
    'reason', outcome.reason, 'ended_at', at, 'last_move_at', at)
  redis.call('HDEL', KEYS[1], 'draw_offered_by', 'white_disconnected_at', 'black_disconnected_at')
end
redis.call('HINCRBY', KEYS[1], 'version', 1)
deadline(ARGV[1])
return snapshot()
`;
