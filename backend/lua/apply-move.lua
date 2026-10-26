
if redis.call('EXISTS', KEYS[1]) == 0 then return fail('GAME_MISSING') end
if field('white_id') ~= ARGV[3] or field('black_id') ~= ARGV[4] then return fail('GAME_FORBIDDEN') end
local m = cjson.decode(ARGV[5])
if m.actorId and m.actorId ~= ARGV[3] and m.actorId ~= ARGV[4] then return fail('GAME_FORBIDDEN') end
if m.kind == 'move' and (field('status') ~= 'active' or number('move_count') ~= tonumber(ARGV[6])) then
  return {'stale'}
end
local function response(status)
  return {status, number('white_time_ms'), number('black_time_ms'), snapshot()}
end
if field('status') == 'completed' then return response('ok') end
if tonumber(field('version') or '0') ~= tonumber(ARGV[2]) then return fail('GAME_CONFLICT') end
if field('status') ~= 'active' then return fail('GAME_NOT_ACTIVE') end
if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('GET', KEYS[3]) ~= ARGV[1] then
  return fail('GAME_INVALID_STATE')
end
local turn = field('turn')
local clock = turn == 'w' and 'white_time_ms' or 'black_time_ms'
local at = math.max(m.at, number('last_move_at'))
local elapsed = at - number('last_move_at')
local lag = m.kind == 'move' and math.min(m.estimatedLagMs or 0, elapsed) or 0
local remaining = number(clock) - math.floor(elapsed - lag)
local outcome = nil
local disconnected = m.actorId == ARGV[3] and 'white_disconnected_at' or 'black_disconnected_at'
if remaining <= 0 then
  remaining = 0
  outcome = { result = m.timeoutResult, reason = 'timeout' }
elseif m.kind == 'timeout' then
  return response('ok')
elseif m.kind == 'disconnect' and field(disconnected) then
  return response('ok')
elseif m.kind == 'reconnect' and not field(disconnected) then
  return response('ok')
elseif m.kind == 'abandon' then
  if not number(disconnected) or m.at < number(disconnected) + 60000 then return fail('GAME_GRACE_ACTIVE') end
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
  (not field('draw_offered_by') or field('draw_offered_by') == m.actorId) then return fail('GAME_DRAW_MISSING')
end
if m.kind == 'move' and remaining > 0 then
  local records = cjson.decode(field('move_records'))
  local move = m.move
  remaining = remaining + number('increment_ms')
  local record = { from = move.from, to = move.to, san = move.san, uci = move.uci,
    fenAfter = move.fenAfter, color = move.color, playedAt = at, timeRemainingMs = remaining }
  if move.promotion then record.promotion = move.promotion end
  records[#records + 1] = record
  local moves = field('moves') or ''
  if moves ~= '' then moves = moves .. ',' end
  redis.call('HSET', KEYS[1], 'fen', move.fenAfter, 'turn', move.turn,
    'last_move_at', at, 'move_records', cjson.encode(records), 'moves', moves .. move.san, 'lag_allowance_ms', 0)
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
schedule(ARGV[1])
return response(outcome and outcome.reason == 'timeout' and 'timeout' or 'ok')
