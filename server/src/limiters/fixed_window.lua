-- Fixed window counter, atomic.
-- KEYS[1] = counter key (caller does not need to include the window id)
-- ARGV[1] = limit
-- ARGV[2] = window size in ms
-- Returns { allowed (1/0), remaining, retryAfterMs }
--
-- Cheapest option (one integer per key) but allows up to 2x the limit
-- across a window boundary. Kept so the README can compare all three.

local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local windowId = math.floor(now / window)
local windowKey = key .. ':' .. windowId

local count = redis.call('INCR', windowKey)
if count == 1 then
  redis.call('PEXPIRE', windowKey, window)
end

if count <= limit then
  return { 1, limit - count, 0 }
end

local retry = (windowId + 1) * window - now
return { 0, 0, retry }
