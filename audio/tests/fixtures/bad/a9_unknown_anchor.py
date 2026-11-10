# A9 (warn): anchor id that does not exist
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, soft_pop(), name='pop', anchor='nope')
    return m.render()
