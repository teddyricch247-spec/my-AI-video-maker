# A10 (warn): DC offset on the output
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, soft_pop(), name='pop')
    return m.render() + 0.05
