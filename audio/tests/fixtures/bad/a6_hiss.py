# A6 (warn): almost all energy above 10 kHz
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(0.5, fade(highpass(noise('white', 0.3, 1), 12000.0, 4), 5, 30), name='hiss')
    return m.render()
