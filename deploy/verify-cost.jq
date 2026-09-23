# $/MTok: input, 5m-write, 1h-write, cache-read, output
def rate($m):
  if   ($m|test("opus"))    then {i:5,   w5:6.25, w1:10, r:0.5, o:25}
  elif ($m|test("haiku"))   then {i:1,   w5:1.25, w1:2,  r:0.1, o:5}
  elif ($m|test("fable"))   then {i:10,  w5:12.5, w1:20, r:1,   o:50}
  elif ($m|test("sonnet-?5")) then {i:2, w5:2.5,  w1:4,  r:0.2, o:10}
  elif ($m|test("sonnet"))  then {i:3,   w5:3.75, w1:6,  r:0.3, o:15}
  else {i:5, w5:6.25, w1:10, r:0.5, o:25} end;
[ inputs
  | select(.type=="assistant" and .message.usage != null)
] | unique_by(.message.id)
  | map( . as $l | rate($l.message.model // "unknown") as $r
       | ($l.message.usage) as $u
       | ( ($u.cache_creation.ephemeral_1h_input_tokens // 0) ) as $w1
       | ( if $u.cache_creation then ($u.cache_creation.ephemeral_5m_input_tokens // 0)
           else ($u.cache_creation_input_tokens // 0) end ) as $w5
       | ( (($u.input_tokens//0) * $r.i)
         + (($u.output_tokens//0) * $r.o)
         + (($u.cache_read_input_tokens//0) * $r.r)
         + ($w5 * $r.w5) + ($w1 * $r.w1) ) / 1000000 )
  | add
