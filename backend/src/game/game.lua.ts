import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const helpers = `
local function fail(code) return redis.error_reply(code) end
local function snapshot() return redis.call('HGETALL', KEYS[1]) end
local function field(name) return redis.call('HGET', KEYS[1], name) end
local function number(name) return tonumber(field(name)) end
local function schedule(id)
  if field('status') == 'completed' then
    redis.call('ZADD', KEYS[4], number('ended_at'), id)
  end
end
`;

export const activateScript = helpers + `
if redis.call('EXISTS', KEYS[1]) == 0 then return fail('GAME_MISSING') end
if field('white_id') ~= ARGV[2] or field('black_id') ~= ARGV[3] or ARGV[2] == ARGV[3] then
  return fail('GAME_FORBIDDEN')
end
if redis.call('GET', KEYS[2]) ~= ARGV[1] or redis.call('GET', KEYS[3]) ~= ARGV[1] then
  return fail('GAME_INVALID_STATE')
end
if field('status') == 'active' or field('status') == 'completed' then return snapshot() end
if field('status') ~= 'waiting' or number('move_count') ~= 0 or field('turn') ~= 'w' then
  return fail('GAME_INVALID_STATE')
end
if number('white_time_ms') ~= 600000 or number('black_time_ms') ~= 600000 then
  return fail('GAME_INVALID_STATE')
end
redis.call('HSET', KEYS[1], 'status', 'active', 'started_at', ARGV[4],
  'last_move_at', ARGV[4], 'lag_allowance_ms', 0, 'version', 1, 'move_records', '[]', 'moves', '')
redis.call('PERSIST', KEYS[1])
redis.call('EXPIRE', KEYS[2], 86400)
redis.call('EXPIRE', KEYS[3], 86400)
return snapshot()
`;

export const cleanupScript = `
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('DEL', KEYS[1])
return 1
`;

// Keep the existing rich move history and mutation contract in one atomic write.
export const mutateScript = helpers + readFileSync(resolve(__dirname, "../../lua/apply-move.lua"), "utf8");
