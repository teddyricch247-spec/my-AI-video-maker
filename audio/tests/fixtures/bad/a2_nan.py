# A2 (error): NaN in the output
import numpy as np
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, soft_pop(), name='pop')
    x = m.render()
    x[20000] = np.nan
    return x
