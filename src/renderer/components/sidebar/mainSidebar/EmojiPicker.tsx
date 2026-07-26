import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Search, Trash2, X } from "lucide-react";

import { useI18n } from "../../../i18n";

export type EmojiPickerProps = {
  /** 触发元素的 ref，用于定位面板 */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** 当前已选 emoji（空字符串表示未选） */
  currentEmoji: string;
  /** 选择 emoji 时触发，空字符串表示清除 */
  onSelect: (emoji: string) => void;
  /** 关闭面板 */
  onClose: () => void;
};

type PanelPosition = {
  top: number;
  left: number;
} | null;

type EmojiEntry = { char: string; keywords: string[] };

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * 精选常用 emoji，按类别分组。每组附带关键词（英文小写）用于搜索匹配。
 * 避免引入完整 emoji 数据集，保持包体积精简。如需扩展可在此处追加。
 */
const EMOJI_GROUPS: Array<{ key: string; emojis: EmojiEntry[] }> = [
  {
    key: "smileys",
    emojis: [
      { char: "😀", keywords: ["smile", "happy", "grin"] },
      { char: "😃", keywords: ["happy", "joy"] },
      { char: "😄", keywords: ["happy", "joy", "laugh"] },
      { char: "😁", keywords: ["grin", "happy"] },
      { char: "😆", keywords: ["laugh", "happy"] },
      { char: "😅", keywords: ["sweat", "laugh"] },
      { char: "🤣", keywords: ["rofl", "laugh"] },
      { char: "😂", keywords: ["joy", "tear", "laugh"] },
      { char: "🙂", keywords: ["smile", "slight"] },
      { char: "🙃", keywords: ["upside", "smile"] },
      { char: "😉", keywords: ["wink"] },
      { char: "😊", keywords: ["blush", "smile"] },
      { char: "😇", keywords: ["angel", "halo"] },
      { char: "🥰", keywords: ["love", "heart"] },
      { char: "😍", keywords: ["love", "heart", "eyes"] },
      { char: "🤩", keywords: ["star", "eyes"] },
      { char: "😘", keywords: ["kiss", "love"] },
      { char: "😋", keywords: ["yum", "tongue"] },
      { char: "😛", keywords: ["tongue"] },
      { char: "😜", keywords: ["wink", "tongue"] },
      { char: "🤪", keywords: ["crazy", "zany"] },
      { char: "🤔", keywords: ["think", "hmm"] },
      { char: "🤨", keywords: ["suspicious"] },
      { char: "😐", keywords: ["neutral"] },
      { char: "😑", keywords: ["expressionless"] },
      { char: "😶", keywords: ["silent"] },
      { char: "😏", keywords: ["smirk"] },
      { char: "😒", keywords: ["unamused"] },
      { char: "🙄", keywords: ["roll", "eyes"] },
      { char: "😬", keywords: ["grimace"] },
      { char: "😌", keywords: ["relieved"] },
      { char: "😔", keywords: ["sad", "pensive"] },
      { char: "😪", keywords: ["sleepy"] },
      { char: "😴", keywords: ["sleep", "zzz"] },
      { char: "😷", keywords: ["mask", "sick"] },
      { char: "🤒", keywords: ["sick", "thermometer"] },
      { char: "🤕", keywords: ["hurt", "bandage"] },
      { char: "🤢", keywords: ["nauseous", "sick"] },
      { char: "🤮", keywords: ["vomit", "sick"] },
      { char: "🥵", keywords: ["hot"] },
      { char: "🥶", keywords: ["cold", "freeze"] },
      { char: "🥳", keywords: ["party", "celebrate"] },
      { char: "😎", keywords: ["cool", "sunglasses"] },
      { char: "🤓", keywords: ["nerd", "glasses"] },
      { char: "🧐", keywords: ["monocle"] },
      { char: "😕", keywords: ["confused"] },
      { char: "😟", keywords: ["worried"] },
      { char: "🙁", keywords: ["frown"] },
      { char: "☹️", keywords: ["sad"] },
      { char: "😮", keywords: ["surprise", "wow"] },
    ],
  },
  {
    key: "gestures",
    emojis: [
      { char: "👍", keywords: ["thumbs", "up", "like", "yes"] },
      { char: "👎", keywords: ["thumbs", "down", "dislike", "no"] },
      { char: "👌", keywords: ["ok", "perfect"] },
      { char: "🤌", keywords: ["pinch"] },
      { char: "🤏", keywords: ["pinch", "small"] },
      { char: "✌️", keywords: ["peace", "victory"] },
      { char: "🤞", keywords: ["fingers", "crossed", "luck"] },
      { char: "🤟", keywords: ["love", "rock"] },
      { char: "🤘", keywords: ["rock"] },
      { char: "🤙", keywords: ["call", "shaka"] },
      { char: "👈", keywords: ["point", "left"] },
      { char: "👉", keywords: ["point", "right"] },
      { char: "👆", keywords: ["point", "up"] },
      { char: "👇", keywords: ["point", "down"] },
      { char: "☝️", keywords: ["point", "up", "one"] },
      { char: "👋", keywords: ["wave", "hi", "hello", "bye"] },
      { char: "🤚", keywords: ["stop", "raised"] },
      { char: "🖐️", keywords: ["hand", "five"] },
      { char: "✋", keywords: ["stop", "hand"] },
      { char: "🖖", keywords: ["vulcan", "spock"] },
      { char: "👏", keywords: ["clap", "applause"] },
      { char: "🙌", keywords: ["raise", "hands", "celebrate"] },
      { char: "👐", keywords: ["open", "hands"] },
      { char: "🤲", keywords: ["palms", "together"] },
      { char: "🙏", keywords: ["pray", "thanks", "please"] },
      { char: "✍️", keywords: ["write", "pen"] },
      { char: "💪", keywords: ["muscle", "strong", "flex"] },
      { char: "🦾", keywords: ["arm", "mechanical"] },
      { char: "🦿", keywords: ["leg", "mechanical"] },
      { char: "🤝", keywords: ["handshake", "deal"] },
    ],
  },
  {
    key: "people",
    emojis: [
      { char: "👶", keywords: ["baby"] },
      { char: "🧒", keywords: ["child"] },
      { char: "👦", keywords: ["boy"] },
      { char: "👧", keywords: ["girl"] },
      { char: "🧑", keywords: ["person"] },
      { char: "👨", keywords: ["man"] },
      { char: "👩", keywords: ["woman"] },
      { char: "🧓", keywords: ["old"] },
      { char: "👴", keywords: ["old", "man"] },
      { char: "👵", keywords: ["old", "woman"] },
      { char: "👮", keywords: ["police", "cop"] },
      { char: "👷", keywords: ["worker", "helmet"] },
      { char: "💂", keywords: ["guard"] },
      { char: "🕵️", keywords: ["spy", "detective"] },
      { char: "👨‍💻", keywords: ["coder", "developer", "man"] },
      { char: "👩‍💻", keywords: ["coder", "developer", "woman"] },
      { char: "🧙", keywords: ["wizard", "mage"] },
      { char: "🧚", keywords: ["fairy"] },
      { char: "🧛", keywords: ["vampire"] },
      { char: "🧜", keywords: ["mermaid"] },
      { char: "🧝", keywords: ["elf"] },
      { char: "🧞", keywords: ["genie"] },
      { char: "🧟", keywords: ["zombie"] },
      { char: "🧠", keywords: ["brain", "smart"] },
      { char: "💀", keywords: ["skull", "dead"] },
      { char: "👻", keywords: ["ghost"] },
      { char: "👽", keywords: ["alien"] },
      { char: "🤖", keywords: ["robot"] },
      { char: "💩", keywords: ["poop"] },
    ],
  },
  {
    key: "animals",
    emojis: [
      { char: "🐶", keywords: ["dog", "puppy"] },
      { char: "🐱", keywords: ["cat", "kitten"] },
      { char: "🐭", keywords: ["mouse"] },
      { char: "🐹", keywords: ["hamster"] },
      { char: "🐰", keywords: ["rabbit", "bunny"] },
      { char: "🦊", keywords: ["fox"] },
      { char: "🐻", keywords: ["bear"] },
      { char: "🐼", keywords: ["panda"] },
      { char: "🐨", keywords: ["koala"] },
      { char: "🐯", keywords: ["tiger"] },
      { char: "🦁", keywords: ["lion"] },
      { char: "🐮", keywords: ["cow"] },
      { char: "🐷", keywords: ["pig"] },
      { char: "🐸", keywords: ["frog"] },
      { char: "🐵", keywords: ["monkey"] },
      { char: "🐔", keywords: ["chicken"] },
      { char: "🐧", keywords: ["penguin"] },
      { char: "🐦", keywords: ["bird"] },
      { char: "🦆", keywords: ["duck"] },
      { char: "🦅", keywords: ["eagle"] },
      { char: "🦉", keywords: ["owl"] },
      { char: "🐺", keywords: ["wolf"] },
      { char: "🐗", keywords: ["boar"] },
      { char: "🐴", keywords: ["horse"] },
      { char: "🦄", keywords: ["unicorn"] },
      { char: "🐝", keywords: ["bee"] },
      { char: "🐛", keywords: ["bug"] },
      { char: "🦋", keywords: ["butterfly"] },
      { char: "🐌", keywords: ["snail"] },
      { char: "🐞", keywords: ["ladybug"] },
      { char: "🐙", keywords: ["octopus"] },
      { char: "🦑", keywords: ["squid"] },
      { char: "🦐", keywords: ["shrimp"] },
      { char: "🦀", keywords: ["crab"] },
      { char: "🐡", keywords: ["fish"] },
      { char: "🐠", keywords: ["fish", "tropical"] },
      { char: "🐟", keywords: ["fish"] },
      { char: "🐬", keywords: ["dolphin"] },
      { char: "🐳", keywords: ["whale"] },
      { char: "🦕", keywords: ["dinosaur"] },
      { char: "🦖", keywords: ["dinosaur", "t-rex"] },
    ],
  },
  {
    key: "food",
    emojis: [
      { char: "🍎", keywords: ["apple", "red"] },
      { char: "🍐", keywords: ["pear"] },
      { char: "🍊", keywords: ["orange"] },
      { char: "🍋", keywords: ["lemon"] },
      { char: "🍌", keywords: ["banana"] },
      { char: "🍉", keywords: ["watermelon"] },
      { char: "🍇", keywords: ["grape"] },
      { char: "🍓", keywords: ["strawberry"] },
      { char: "🫐", keywords: ["blueberry"] },
      { char: "🍈", keywords: ["melon"] },
      { char: "🍒", keywords: ["cherry"] },
      { char: "🍑", keywords: ["peach"] },
      { char: "🥭", keywords: ["mango"] },
      { char: "🍍", keywords: ["pineapple"] },
      { char: "🥥", keywords: ["coconut"] },
      { char: "🥝", keywords: ["kiwi"] },
      { char: "🍅", keywords: ["tomato"] },
      { char: "🥑", keywords: ["avocado"] },
      { char: "🍔", keywords: ["burger"] },
      { char: "🍟", keywords: ["fries"] },
      { char: "🍕", keywords: ["pizza"] },
      { char: "🌭", keywords: ["hotdog"] },
      { char: "🥪", keywords: ["sandwich"] },
      { char: "🌮", keywords: ["taco"] },
      { char: "🌯", keywords: ["burrito"] },
      { char: "🥗", keywords: ["salad"] },
      { char: "🍿", keywords: ["popcorn"] },
      { char: "🧈", keywords: ["butter"] },
      { char: "🧂", keywords: ["salt"] },
      { char: "🥚", keywords: ["egg"] },
      { char: "🍳", keywords: ["egg", "fried"] },
      { char: "🥞", keywords: ["pancake"] },
      { char: "🧇", keywords: ["waffle"] },
      { char: "🥖", keywords: ["bread", "baguette"] },
      { char: "🍞", keywords: ["bread"] },
      { char: "🧀", keywords: ["cheese"] },
      { char: "🍚", keywords: ["rice"] },
      { char: "🍜", keywords: ["noodle", "ramen"] },
      { char: "🍝", keywords: ["pasta", "spaghetti"] },
      { char: "🍣", keywords: ["sushi"] },
      { char: "🍱", keywords: ["bento"] },
      { char: "🍪", keywords: ["cookie"] },
      { char: "🎂", keywords: ["cake", "birthday"] },
      { char: "🍰", keywords: ["cake"] },
      { char: "🧁", keywords: ["cupcake"] },
      { char: "🍫", keywords: ["chocolate"] },
      { char: "🍬", keywords: ["candy"] },
      { char: "🍭", keywords: ["lollipop"] },
      { char: "🍩", keywords: ["donut"] },
      { char: "☕", keywords: ["coffee"] },
      { char: "🍵", keywords: ["tea"] },
      { char: "🧃", keywords: ["juice"] },
      { char: "🍺", keywords: ["beer"] },
      { char: "🍻", keywords: ["beer", "cheers"] },
      { char: "🥂", keywords: ["cheers"] },
      { char: "🍷", keywords: ["wine"] },
    ],
  },
  {
    key: "activities",
    emojis: [
      { char: "⚽", keywords: ["soccer", "football"] },
      { char: "🏀", keywords: ["basketball"] },
      { char: "🏈", keywords: ["football"] },
      { char: "⚾", keywords: ["baseball"] },
      { char: "🥎", keywords: ["softball"] },
      { char: "🎾", keywords: ["tennis"] },
      { char: "🏐", keywords: ["volleyball"] },
      { char: "🏉", keywords: ["rugby"] },
      { char: "🥏", keywords: ["frisbee"] },
      { char: "🎱", keywords: ["pool", "billiards"] },
      { char: "🏓", keywords: ["ping", "pong"] },
      { char: "🏸", keywords: ["badminton"] },
      { char: "🏒", keywords: ["hockey"] },
      { char: "🏑", keywords: ["hockey", "field"] },
      { char: "🏏", keywords: ["cricket"] },
      { char: "🎮", keywords: ["game", "controller"] },
      { char: "🕹️", keywords: ["joystick"] },
      { char: "🎲", keywords: ["dice"] },
      { char: "🎯", keywords: ["dart", "target"] },
      { char: "🎳", keywords: ["bowling"] },
      { char: "🎨", keywords: ["art", "paint"] },
      { char: "🎭", keywords: ["theater", "drama"] },
      { char: "🎤", keywords: ["mic", "sing"] },
      { char: "🎧", keywords: ["headphone", "music"] },
      { char: "🎼", keywords: ["music", "score"] },
      { char: "🎹", keywords: ["piano"] },
      { char: "🥁", keywords: ["drum"] },
      { char: "🎷", keywords: ["saxophone"] },
      { char: "🎺", keywords: ["trumpet"] },
      { char: "🎸", keywords: ["guitar"] },
      { char: "🎻", keywords: ["violin"] },
      { char: "🏆", keywords: ["trophy", "win"] },
      { char: "🥇", keywords: ["gold", "medal"] },
      { char: "🥈", keywords: ["silver", "medal"] },
      { char: "🥉", keywords: ["bronze", "medal"] },
      { char: "🎽", keywords: ["running"] },
      { char: "🥊", keywords: ["boxing"] },
      { char: "🥋", keywords: ["martial", "arts"] },
      { char: "⛸️", keywords: ["ice", "skate"] },
      { char: "🛷", keywords: ["sled"] },
    ],
  },
  {
    key: "travel",
    emojis: [
      { char: "🚗", keywords: ["car"] },
      { char: "🚕", keywords: ["taxi"] },
      { char: "🚙", keywords: ["suv"] },
      { char: "🚌", keywords: ["bus"] },
      { char: "🚎", keywords: ["trolleybus"] },
      { char: "🏎️", keywords: ["race", "car"] },
      { char: "🚓", keywords: ["police", "car"] },
      { char: "🚑", keywords: ["ambulance"] },
      { char: "🚒", keywords: ["fire", "truck"] },
      { char: "🚐", keywords: ["minibus"] },
      { char: "🚚", keywords: ["truck"] },
      { char: "🚛", keywords: ["truck", "semi"] },
      { char: "🏍️", keywords: ["motorcycle"] },
      { char: "🛵", keywords: ["scooter"] },
      { char: "🚲", keywords: ["bicycle", "bike"] },
      { char: "🛴", keywords: ["scooter"] },
      { char: "✈️", keywords: ["plane", "fly"] },
      { char: "🚀", keywords: ["rocket", "space"] },
      { char: "🛸", keywords: ["ufo"] },
      { char: "🚁", keywords: ["helicopter"] },
      { char: "⛵", keywords: ["sailboat", "boat"] },
      { char: "🚤", keywords: ["speedboat"] },
      { char: "🛳️", keywords: ["ship"] },
      { char: "⛴️", keywords: ["ferry"] },
      { char: "🚢", keywords: ["ship"] },
      { char: "🚂", keywords: ["train"] },
      { char: "🚆", keywords: ["train"] },
      { char: "🚊", keywords: ["tram"] },
      { char: "🚇", keywords: ["metro", "subway"] },
      { char: "🚉", keywords: ["station"] },
      { char: "🗺️", keywords: ["map"] },
      { char: "🗿", keywords: ["moai", "statue"] },
      { char: "🗽", keywords: ["statue", "liberty"] },
      { char: "🗼", keywords: ["tower"] },
      { char: "🏰", keywords: ["castle"] },
      { char: "🏯", keywords: ["castle"] },
      { char: "🎡", keywords: ["ferris", "wheel"] },
      { char: "🎢", keywords: ["rollercoaster"] },
      { char: "🎠", keywords: ["carousel"] },
      { char: "⛲", keywords: ["fountain"] },
    ],
  },
  {
    key: "objects",
    emojis: [
      { char: "💡", keywords: ["idea", "light", "bulb"] },
      { char: "🔦", keywords: ["flashlight"] },
      { char: "📔", keywords: ["notebook"] },
      { char: "📕", keywords: ["book"] },
      { char: "📖", keywords: ["book", "read"] },
      { char: "📗", keywords: ["book"] },
      { char: "📘", keywords: ["book"] },
      { char: "📙", keywords: ["book"] },
      { char: "📚", keywords: ["books", "library"] },
      { char: "📓", keywords: ["notebook"] },
      { char: "📒", keywords: ["notebook"] },
      { char: "📃", keywords: ["page"] },
      { char: "📜", keywords: ["scroll"] },
      { char: "📄", keywords: ["document"] },
      { char: "📰", keywords: ["newspaper", "news"] },
      { char: "📑", keywords: ["bookmark"] },
      { char: "🔖", keywords: ["bookmark"] },
      { char: "💰", keywords: ["money", "bag"] },
      { char: "💳", keywords: ["credit", "card"] },
      { char: "💵", keywords: ["dollar", "money"] },
      { char: "💴", keywords: ["yen", "money"] },
      { char: "💶", keywords: ["euro", "money"] },
      { char: "💷", keywords: ["pound", "money"] },
      { char: "🔧", keywords: ["wrench", "tool"] },
      { char: "🔨", keywords: ["hammer", "tool"] },
      { char: "⚒️", keywords: ["hammer", "pick"] },
      { char: "🛠️", keywords: ["tools"] },
      { char: "⚙️", keywords: ["gear", "settings"] },
      { char: "🧰", keywords: ["toolbox"] },
      { char: "🔑", keywords: ["key"] },
      { char: "🗝️", keywords: ["key"] },
      { char: "🔒", keywords: ["lock", "closed"] },
      { char: "🔓", keywords: ["lock", "open", "unlock"] },
      { char: "🔔", keywords: ["bell", "notification"] },
      { char: "🔕", keywords: ["bell", "mute"] },
      { char: "📱", keywords: ["phone", "mobile"] },
      { char: "💻", keywords: ["laptop", "computer"] },
      { char: "⌨️", keywords: ["keyboard"] },
      { char: "🖥️", keywords: ["desktop"] },
      { char: "🖱️", keywords: ["mouse"] },
      { char: "💾", keywords: ["save", "floppy"] },
      { char: "💿", keywords: ["cd", "disc"] },
      { char: "📷", keywords: ["camera", "photo"] },
      { char: "📸", keywords: ["camera", "flash"] },
      { char: "🎥", keywords: ["camera", "movie"] },
      { char: "📺", keywords: ["tv", "television"] },
      { char: "📻", keywords: ["radio"] },
      { char: "⏰", keywords: ["alarm", "clock"] },
      { char: "⏱️", keywords: ["timer"] },
      { char: "🔋", keywords: ["battery"] },
      { char: "🔌", keywords: ["plug", "power"] },
    ],
  },
  {
    key: "symbols",
    emojis: [
      { char: "⭐", keywords: ["star"] },
      { char: "🌟", keywords: ["star", "glow"] },
      { char: "✨", keywords: ["sparkle", "shine"] },
      { char: "⚡", keywords: ["lightning", "energy"] },
      { char: "🔥", keywords: ["fire", "hot"] },
      { char: "💥", keywords: ["explosion", "boom"] },
      { char: "💫", keywords: ["dizzy", "star"] },
      { char: "🌈", keywords: ["rainbow"] },
      { char: "☀️", keywords: ["sun", "sunny"] },
      { char: "🌤️", keywords: ["sun", "cloud"] },
      { char: "⛅", keywords: ["cloud", "sun"] },
      { char: "☁️", keywords: ["cloud"] },
      { char: "🌧️", keywords: ["rain"] },
      { char: "⛈️", keywords: ["storm", "rain"] },
      { char: "❄️", keywords: ["snow", "cold"] },
      { char: "☃️", keywords: ["snowman"] },
      { char: "💧", keywords: ["drop", "water"] },
      { char: "🌊", keywords: ["wave", "ocean"] },
      { char: "🎉", keywords: ["party", "celebrate", "tada"] },
      { char: "🎊", keywords: ["confetti", "party"] },
      { char: "🎈", keywords: ["balloon", "party"] },
      { char: "🎁", keywords: ["gift", "present"] },
      { char: "✅", keywords: ["check", "done", "yes"] },
      { char: "❌", keywords: ["cross", "no", "wrong"] },
      { char: "❤️", keywords: ["love", "heart", "red"] },
      { char: "🧡", keywords: ["heart", "orange"] },
      { char: "💛", keywords: ["heart", "yellow"] },
      { char: "💚", keywords: ["heart", "green"] },
      { char: "💙", keywords: ["heart", "blue"] },
      { char: "💜", keywords: ["heart", "purple"] },
      { char: "🖤", keywords: ["heart", "black"] },
      { char: "🤍", keywords: ["heart", "white"] },
      { char: "💔", keywords: ["heart", "broken"] },
      { char: "💯", keywords: ["100", "hundred", "perfect"] },
      { char: "💢", keywords: ["angry"] },
      { char: "💣", keywords: ["bomb"] },
      { char: "💤", keywords: ["sleep", "zzz"] },
      { char: "❓", keywords: ["question"] },
      { char: "❗", keywords: ["exclamation"] },
      { char: "💬", keywords: ["speech", "chat"] },
      { char: "💭", keywords: ["thought"] },
    ],
  },
];

const GROUP_LABEL_KEYS: Record<string, string> = {
  smileys: "sidebar.emojiGroupSmileys",
  gestures: "sidebar.emojiGroupGestures",
  people: "sidebar.emojiGroupPeople",
  animals: "sidebar.emojiGroupAnimals",
  food: "sidebar.emojiGroupFood",
  activities: "sidebar.emojiGroupActivities",
  travel: "sidebar.emojiGroupTravel",
  objects: "sidebar.emojiGroupObjects",
  symbols: "sidebar.emojiGroupSymbols",
};

const GROUP_DEFAULT_LABELS: Record<string, string> = {
  smileys: "Smileys",
  gestures: "Gestures",
  people: "People",
  animals: "Animals",
  food: "Food & Drink",
  activities: "Activities",
  travel: "Travel",
  objects: "Objects",
  symbols: "Symbols",
};

/** 将所有 emoji 展平为一维数组，用于搜索 */
const ALL_EMOJIS: EmojiEntry[] = EMOJI_GROUPS.flatMap((g) => g.emojis);

export function EmojiPicker({
  triggerRef,
  currentEmoji,
  onSelect,
  onClose,
}: EmojiPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<PanelPosition>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const computePosition = useCallback((): PanelPosition => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger) {
      return null;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel
      ? panel.getBoundingClientRect()
      : { width: 280, height: 360 };

    const spaceRight = window.innerWidth - triggerRect.right - VIEWPORT_MARGIN;
    const preferredLeft =
      spaceRight >= panelRect.width + PANEL_GAP
        ? triggerRect.right + PANEL_GAP
        : triggerRect.left - panelRect.width - PANEL_GAP;

    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - panelRect.height - VIEWPORT_MARGIN
    );
    const preferredTop = triggerRect.top;

    return {
      top: Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), maxTop),
      left: Math.min(
        Math.max(preferredLeft, VIEWPORT_MARGIN),
        Math.max(
          VIEWPORT_MARGIN,
          window.innerWidth - panelRect.width - VIEWPORT_MARGIN
        )
      ),
    };
  }, [triggerRef]);

  const updatePosition = useCallback((): void => {
    setPosition(computePosition());
  }, [computePosition]);

  useLayoutEffect(() => {
    updatePosition();
    const sidebar = triggerRef.current?.closest<HTMLElement>(".sidebar");
    const observer = new ResizeObserver(() => updatePosition());
    if (panelRef.current) {
      observer.observe(panelRef.current);
    }
    if (sidebar) {
      observer.observe(sidebar);
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition, triggerRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // 搜索过滤：匹配关键词或 emoji 字符本身
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return EMOJI_GROUPS;
    }
    const matched = ALL_EMOJIS.filter(
      (entry) =>
        entry.keywords.some((kw) => kw.includes(query)) ||
        entry.char.includes(searchQuery.trim())
    );
    if (matched.length === 0) {
      return [];
    }
    return [{ key: "search", emojis: matched }];
  }, [searchQuery]);

  const handleSelect = (emoji: string): void => {
    onSelect(emoji);
    onClose();
  };

  const handleClear = (): void => {
    onSelect("");
    onClose();
  };

  const handleClearSearch = (): void => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  };

  const hasResults = filteredGroups.length > 0;

  return createPortal(
    <div
      ref={panelRef}
      className="emoji-picker"
      style={position ? { top: position.top, left: position.left } : undefined}
      role="dialog"
      aria-label={t("sidebar.emojiPickerLabel", {
        defaultValue: "Select an emoji",
      })}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="emoji-picker-header">
        <span className="emoji-picker-title">
          {t("sidebar.emojiPickerTitle", { defaultValue: "Choose icon" })}
        </span>
        {currentEmoji && (
          <button
            type="button"
            className="emoji-picker-clear-btn"
            onClick={handleClear}
            aria-label={t("sidebar.emojiClear", {
              defaultValue: "Clear emoji",
            })}
            title={t("sidebar.emojiClear", { defaultValue: "Clear emoji" })}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="emoji-picker-search">
        <Search size={12} className="emoji-picker-search-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="emoji-picker-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("sidebar.emojiSearchPlaceholder", {
            defaultValue: "Search emoji...",
          })}
          autoFocus
        />
        {searchQuery && (
          <button
            type="button"
            className="emoji-picker-search-clear"
            onClick={handleClearSearch}
            aria-label={t("sidebar.emojiClearSearch", {
              defaultValue: "Clear search",
            })}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="emoji-picker-body">
        {hasResults ? (
          filteredGroups.map((group) => (
            <div key={group.key} className="emoji-picker-group">
              <div className="emoji-picker-group-label">
                {searchQuery
                  ? t("sidebar.emojiSearchResults", {
                      defaultValue: "Search results",
                    })
                  : t(GROUP_LABEL_KEYS[group.key], {
                      defaultValue: GROUP_DEFAULT_LABELS[group.key],
                    })}
              </div>
              <div className="emoji-picker-grid">
                {group.emojis.map((entry) => (
                  <button
                    key={entry.char}
                    type="button"
                    className={`emoji-picker-item${
                      entry.char === currentEmoji ? " selected" : ""
                    }`}
                    onClick={() => handleSelect(entry.char)}
                    aria-label={entry.char}
                    title={entry.keywords.join(", ")}
                  >
                    {entry.char}
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="emoji-picker-no-results">
            {t("sidebar.emojiNoResults", {
              defaultValue: "No emoji found",
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
