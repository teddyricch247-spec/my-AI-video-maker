# minimal: the smallest useful cue script. One soft pop when the word 'here' starts.
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(ctx.at('w0202'), soft_pop(), gain_db=-4, name='pop', anchor='w0202')
    return m.render()
