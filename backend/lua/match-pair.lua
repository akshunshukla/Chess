-- KEYS[1]: rating queue. ARGV: user ID, allowed rating difference.
local score = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1]))
if not score then return nil end

local window = tonumber(ARGV[2])
local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], score - window, score + window, 'WITHSCORES')
local opponent = nil
local closest = nil
for i = 1, #candidates, 2 do
  if candidates[i] ~= ARGV[1] then
    local distance = math.abs(tonumber(candidates[i + 1]) - score)
    if not closest or distance < closest then
      closest = distance
      opponent = candidates[i]
    end
  end
end

if not opponent then return nil end
redis.call('ZREM', KEYS[1], ARGV[1], opponent)
return opponent
