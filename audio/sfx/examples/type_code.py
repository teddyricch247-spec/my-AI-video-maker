# type_code: a command is typed, then Enter is pressed. A run of key presses is one texture, so it goes
# through add_group (a run of 8 keys is about 0.8 s, which counts as 2 events), then one click on 'enter'.
from synth import *


def render(ctx):
    m = ctx.mix()
    t0 = ctx.at('w0903')  # typing starts with the word 'command'
    # type_key_events gives [(offset_s, key_sound)]; rate 9 keys/s with natural jitter, seeded for repeatability.
    keys = [(t0 + off, k) for off, k in type_key_events(n=8, rate=9, seed=ctx.seed + 1)]
    m.add_group('typing', keys, gain_db=-9, anchor='w0903')
    # Enter: a crisp click that matches the 'enter' tick marker. soft=0.3 keeps it crisp but not harsh.
    m.add(ctx.marker('enter'), click(soft=0.3), gain_db=-4, name='enter', anchor='enter')
    return m.render()
