/* ChatWallpaper — dense doodle-icon wallpaper for the chat area.
   Style: WhatsApp-style outline icons (banana 🍌, wifi 📶, chat 💬)
   scattered at varied sizes / rotations to create a rich tile pattern.
   All icons use stroke only (fill=none) so a single CSS variable drives
   both light and dark themes.                                            */

export function ChatWallpaper() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <defs>
        {/* ── icon symbol definitions ─────────────────────────────────────── */}

        {/* BANANA — outline crescent centered at 0,0, bounding ~90×54 */}
        <symbol id="ic-banana" viewBox="-45 -27 90 54">
          <path
            d="M -38,5 Q -36,-22 0,-24 Q 36,-22 40,-4 Q 43,10 30,20 Q 10,28 -12,24 Q -36,18 -38,5 Z"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M 40,-4 Q 46,-18 39,-24"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M -38,5 Q -44,2 -41,12"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </symbol>

        {/* WIFI — 3 arcs + dot, centered at 0,0, bounding ~50×46 */}
        <symbol id="ic-wifi" viewBox="-25 -23 50 46">
          <circle cx="0" cy="19" r="3" fill="var(--chat-wall-icon)" />
          <path
            d="M -9,10 Q 0,2 9,10"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M -17,3 Q 0,-10 17,3"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M -24,-5 Q 0,-20 24,-5"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </symbol>

        {/* CHAT BUBBLE — rounded rect with tail, bounding ~56×52 */}
        <symbol id="ic-chat" viewBox="-28 -26 56 52">
          <path
            d="M -20,-20 Q -20,-22 -18,-22 L 18,-22 Q 20,-22 20,-20 L 20,8 Q 20,10 18,10 L 6,10 L 0,22 L -6,10 L -18,10 Q -20,10 -20,8 Z"
            fill="none"
            stroke="var(--chat-wall-icon)"
            strokeWidth="2.3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* three dots inside bubble */}
          <circle cx="-7" cy="-6" r="2.2" fill="var(--chat-wall-icon)" />
          <circle cx="0"  cy="-6" r="2.2" fill="var(--chat-wall-icon)" />
          <circle cx="7"  cy="-6" r="2.2" fill="var(--chat-wall-icon)" />
        </symbol>

        {/* SPARKLE — small 4-point star used as gap filler */}
        <symbol id="ic-spark" viewBox="-10 -10 20 20">
          <path
            d="M 0,-9 L 1.5,-1.5 L 9,0 L 1.5,1.5 L 0,9 L -1.5,1.5 L -9,0 L -1.5,-1.5 Z"
            fill="var(--chat-wall-icon)"
          />
        </symbol>

        {/* ── tile pattern: 320×320 ─────────────────────────────────────── */}
        <pattern
          id="chat-wall-pattern"
          x="0" y="0"
          width="320" height="320"
          patternUnits="userSpaceOnUse"
        >
          <rect width="320" height="320" fill="var(--chat-wall-bg)" />

          {/* ── row 0 (y~45) ─────────────────────────────────────────────── */}
          <Ico id="ic-chat"   cx={42}  cy={42}  rot={12}   s={1.0}  op={0.07} />
          <Ico id="ic-wifi"   cx={118} cy={34}  rot={-8}   s={0.80} op={0.06} />
          <Ico id="ic-banana" cx={210} cy={46}  rot={22}   s={0.90} op={0.08} />
          <Ico id="ic-chat"   cx={290} cy={38}  rot={-18}  s={0.75} op={0.06} />

          {/* ── row 1 (y~108) ────────────────────────────────────────────── */}
          <Ico id="ic-banana" cx={22}  cy={108} rot={-30}  s={0.75} op={0.07} />
          <Ico id="ic-spark"  cx={80}  cy={88}  rot={20}   s={0.70} op={0.08} />
          <Ico id="ic-chat"   cx={110} cy={112} rot={5}    s={0.60} op={0.06} />
          <Ico id="ic-wifi"   cx={182} cy={100} rot={18}   s={0.95} op={0.07} />
          <Ico id="ic-spark"  cx={248} cy={88}  rot={-30}  s={0.65} op={0.08} />
          <Ico id="ic-banana" cx={272} cy={112} rot={-42}  s={0.70} op={0.06} />
          <Ico id="ic-chat"   cx={318} cy={105} rot={10}   s={0.60} op={0.06} />

          {/* ── row 2 (y~178) ────────────────────────────────────────────── */}
          <Ico id="ic-wifi"   cx={58}  cy={178} rot={0}    s={1.0}  op={0.07} />
          <Ico id="ic-spark"  cx={142} cy={158} rot={45}   s={0.75} op={0.08} />
          <Ico id="ic-banana" cx={155} cy={178} rot={130}  s={0.85} op={0.07} />
          <Ico id="ic-chat"   cx={242} cy={182} rot={-22}  s={0.78} op={0.07} />
          <Ico id="ic-spark"  cx={308} cy={162} rot={0}    s={0.65} op={0.08} />

          {/* ── row 3 (y~245) ────────────────────────────────────────────── */}
          <Ico id="ic-chat"   cx={28}  cy={248} rot={20}   s={0.80} op={0.06} />
          <Ico id="ic-banana" cx={95}  cy={254} rot={-55}  s={0.65} op={0.07} />
          <Ico id="ic-spark"  cx={164} cy={232} rot={-20}  s={0.70} op={0.08} />
          <Ico id="ic-wifi"   cx={182} cy={252} rot={-10}  s={0.88} op={0.07} />
          <Ico id="ic-banana" cx={275} cy={246} rot={8}    s={0.95} op={0.07} />

          {/* ── row 4 (y~310) ────────────────────────────────────────────── */}
          <Ico id="ic-wifi"   cx={52}  cy={308} rot={15}   s={0.70} op={0.06} />
          <Ico id="ic-chat"   cx={148} cy={314} rot={-5}   s={0.65} op={0.06} />
          <Ico id="ic-spark"  cx={218} cy={296} rot={30}   s={0.75} op={0.08} />
          <Ico id="ic-banana" cx={252} cy={310} rot={60}   s={0.80} op={0.07} />
          <Ico id="ic-chat"   cx={318} cy={305} rot={-25}  s={0.70} op={0.06} />
        </pattern>
      </defs>

      <rect width="100%" height="100%" fill="url(#chat-wall-pattern)" />
    </svg>
  );
}

/* ── renders one icon symbol instance ────────────────────────────────────── */
interface IcoProps {
  id: string;
  cx: number;
  cy: number;
  rot: number;
  s: number;
  op: number;
}
function Ico({ id, cx, cy, rot, s, op }: IcoProps) {
  const size = 56 * s;
  return (
    <use
      href={`#${id}`}
      x={cx - size / 2}
      y={cy - size / 2}
      width={size}
      height={size}
      transform={`rotate(${rot},${cx},${cy})`}
      opacity={op}
    />
  );
}
