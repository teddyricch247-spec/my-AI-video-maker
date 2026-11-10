# clean: one pop exactly on the marker 'land'
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(ctx.marker('land'), soft_pop(), name='pop', anchor='land', align='peak')
    return m.render()
