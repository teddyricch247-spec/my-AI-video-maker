# stat_land: a big number counts up and lands (marker 'land', kind thud) at 1.8 s in a 5 s beat.
# Budget: 5 s allows about 3 events, so the count ticks are ONE group, plus the thunk and the chime = 3.
from synth import *


def render(ctx):
    m = ctx.mix()
    land = ctx.marker('land')
    # Ticks start when the number word 'forty' starts and finish 180 ms before the landing.
    # ease_in = gaps shrink, so the counter sounds like it is speeding up.
    times = tick_times(ctx.at('w0303'), land - 0.18, 7, 'ease_in')
    # Rising pitch for each tick; the run is 0.57 s long, so it counts as a single event.
    ticks = [(t, pen_tick(pitch=1600 + 90 * i)) for i, t in enumerate(times)]
    m.add_group('count_ticks', ticks, gain_db=-9, anchor='w0303')
    # The hit: align='peak' puts the loudest moment exactly on the visual landing. Accent = 0 dB.
    m.add(land, wood_thunk(pitch=125), gain_db=0, name='thunk', anchor='land', align='peak')
    # A small bell right after the thud says "that number matters". Ordinary level = -4 dB.
    m.add(land + 0.07, chime(pitch=990), gain_db=-4, name='chime', anchor='land')
    return m.render()
