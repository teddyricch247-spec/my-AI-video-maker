# A1 (error): 1.5 s too long (more than 1 s off); the runner still trims it
import numpy as np
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, soft_pop(), name='pop')
    return np.concatenate([m.render(), np.zeros(int(1.5 * ctx.sr), dtype=np.float32)])
