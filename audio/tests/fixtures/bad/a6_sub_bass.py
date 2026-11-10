# A6 (warn): almost all energy below 50 Hz
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(0.5, fade(osc('sine', 40.0, 0.6), 20, 60), name='rumble')
    return m.render()
