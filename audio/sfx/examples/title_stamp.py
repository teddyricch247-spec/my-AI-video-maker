# title_stamp: a title card slides in, then gets stamped. Only two events in a 4 s beat.
from synth import *


def render(ctx):
    m = ctx.mix()
    # Paper sliding in: peak on the slide marker (the moment the card is fully in place).
    m.add(ctx.marker('slide'), paper_slide(dur=0.35, bright=0.5), gain_db=-4, name='card_slide',
          anchor='slide', align='peak')
    # The stamp is the accent of the beat (0 dB). weight > 1 makes it heavier and a little lower.
    m.add(ctx.marker('stamp'), stamp(weight=1.2), gain_db=0, name='stamp', anchor='stamp', align='peak')
    return m.render()
