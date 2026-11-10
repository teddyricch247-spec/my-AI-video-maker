# A4 (warn): 4 events in 5 s (limit about 3)
from synth import *


def render(ctx):
    m = ctx.mix()
    for i in range(4):
        m.add(0.3 + 1.2 * i, pen_tick(), name=f'tick{i}')
    return m.render()
