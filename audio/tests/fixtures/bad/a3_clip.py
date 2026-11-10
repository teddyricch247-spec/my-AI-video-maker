# A3 (warn): hard clipped at +-1
import numpy as np
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, np.clip(soft_pop() * 6.0, -1.0, 1.0), name='pop')
    return m.render()
