# A5 (warn): a chime that is still ringing when the beat ends
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(ctx.dur - 0.1, chime(), name='late_chime')
    return m.render()
