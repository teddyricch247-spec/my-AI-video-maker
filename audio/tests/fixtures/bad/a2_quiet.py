# A2 (warn): raw peak about -56 dBFS, normalisation would amplify noise
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, gain_db(soft_pop(), -50), name='pop')
    return m.render()
