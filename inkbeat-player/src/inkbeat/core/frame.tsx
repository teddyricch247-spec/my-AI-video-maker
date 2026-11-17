// Fonts: wait for them so no frame ever shows the fallback font (the player stays on a black stage until they load).
import { useEffect, useState } from "react";

let fontsP: Promise<void> | null = null;
const loadFonts = () => {
  if (!fontsP)
    fontsP = Promise.all(
      [
        ["/fonts/Poppins-ExtraBold.ttf", "800"],
        ["/fonts/Poppins-Bold.ttf", "700"],
      ].map(([f, w]) =>
        new FontFace("Poppins", `url(${f})`, { weight: w })
          .load()
          .then((x) => {
            document.fonts.add(x);
          })
          .catch(() => undefined),
      ),
    ).then(() => undefined);
  return fontsP;
};
export const useFonts = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadFonts().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
};
