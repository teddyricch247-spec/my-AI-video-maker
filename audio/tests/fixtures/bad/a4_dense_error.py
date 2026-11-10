# A4 (error): 9 events in 5 s
from synth import *


def render(ctx):
    m = ctx.mix()
    for i in range(9):
        m.add(0.3 + 0.5 * i, pen_tick(), name=f'tick{i}')
    return m.render()
