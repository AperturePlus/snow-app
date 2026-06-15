type PixelLetter = ReadonlyArray<string>;

type PixelLogoProps = {
  text?: string;
  pixelSize?: number;
  letterGap?: number;
  lineGap?: number;
  color?: string;
  className?: string;
};

const LETTER_WIDTH = 5;
const LETTER_HEIGHT = 7;

const PIXEL_LETTERS: Record<string, PixelLetter> = {
  S: [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

const getLetter = (char: string): PixelLetter => {
  const upper = char.toUpperCase();
  return PIXEL_LETTERS[upper] ?? PIXEL_LETTERS[" "];
};

export const PixelLogo = ({
  text = "SNOW APP",
  pixelSize = 3,
  letterGap = 1,
  lineGap = 0,
  color = "currentColor",
  className,
}: PixelLogoProps): React.JSX.Element => {
  const chars = text.split("");
  const rows = 1;

  const totalWidth =
    chars.length * LETTER_WIDTH + Math.max(0, chars.length - 1) * letterGap;
  const totalHeight = rows * LETTER_HEIGHT + Math.max(0, rows - 1) * lineGap;

  const rects: React.JSX.Element[] = [];

  chars.forEach((char, charIndex) => {
    const letter = getLetter(char);
    const offsetX = charIndex * (LETTER_WIDTH + letterGap);

    letter.forEach((row, rowIndex) => {
      row.split("").forEach((cell, colIndex) => {
        if (cell === "#") {
          rects.push(
            <rect
              key={`${charIndex}-${rowIndex}-${colIndex}`}
              x={(offsetX + colIndex) * pixelSize}
              y={rowIndex * pixelSize}
              width={pixelSize}
              height={pixelSize}
              fill={color}
            />
          );
        }
      });
    });
  });

  return (
    <svg
      className={className}
      width={totalWidth * pixelSize}
      height={totalHeight * pixelSize}
      viewBox={`0 0 ${totalWidth * pixelSize} ${totalHeight * pixelSize}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-label={text}
      role="img"
    >
      {rects}
    </svg>
  );
};
