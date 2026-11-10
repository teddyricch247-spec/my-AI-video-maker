# A8 (info): marker 'land' (1.2 s) has no cue near it
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(3.0, soft_pop(), name='pop')
    return m.render()
