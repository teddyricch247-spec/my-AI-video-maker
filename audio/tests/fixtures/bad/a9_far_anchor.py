# A9 (warn): the cue is anchored to 'land' (1.2 s) but placed at 4.0 s
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(4.0, soft_pop(), name='pop', anchor='land')
    return m.render()
