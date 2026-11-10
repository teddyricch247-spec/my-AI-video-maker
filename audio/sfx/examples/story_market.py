# story_market: narration-only beat, 12 s. Restraint is the point: one cloth rustle as the scene opens and a
# single small bell on the word 'bell'. Everything else stays silent so the voice can carry the story.
from synth import *


def render(ctx):
    m = ctx.mix()
    # Soft detail (-9 dB) on the marker: the market stalls' cloth moving.
    m.add(ctx.marker('r1'), cloth_rustle(dur=0.6), gain_db=-9, name='stalls_rustle', anchor='r1')
    # The chime lands exactly where the word 'bell' starts. Ordinary level (-4 dB), no tail effects.
    m.add(ctx.at('w1209'), chime(pitch=1040), gain_db=-4, name='bell', anchor='w1209')
    return m.render()
