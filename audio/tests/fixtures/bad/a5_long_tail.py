# A5 (warn): a cue audible for 1.6 s (limit 1.2 s)
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(0.5, cloth_rustle(dur=1.6), name='long_rustle')
    return m.render()
