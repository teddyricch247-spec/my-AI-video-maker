# A1 (warn): the returned array is 0.1 s shorter than ctx.samples; the runner pads it with zeros
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, soft_pop(), name='pop')
    return m.render()[:-4800]
