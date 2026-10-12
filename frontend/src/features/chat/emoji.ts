/** A compact emoji set for reactions and the composer (FR-MSG-09: Unicode emoji only). */

export type EmojiEntry = { emoji: string; name: string };
export type EmojiCategory = { name: string; emojis: EmojiEntry[] };

const data: [string, string][] = [
  // [category, "emoji name|emoji name|..."]
  [
    "Smileys",
    "😀 grinning|😃 smiley|😄 smile|😁 grin|😆 laughing|😅 sweat smile|😂 joy|🤣 rofl|😊 blush|" +
      "😇 innocent|🙂 slightly smiling|🙃 upside down|😉 wink|😌 relieved|😍 heart eyes|" +
      "🥰 smiling hearts|😘 kissing heart|😋 yum|😛 tongue|😜 winking tongue|🤪 zany|🤨 raised eyebrow|" +
      "🧐 monocle|🤓 nerd|😎 sunglasses|🥳 partying|😏 smirk|😒 unamused|😞 disappointed|😔 pensive|" +
      "😟 worried|😕 confused|🙁 frowning|😣 persevere|😖 confounded|😫 tired|😩 weary|🥺 pleading|" +
      "😢 cry|😭 sob|😤 triumph|😠 angry|😡 rage|🤯 exploding head|😳 flushed|🥵 hot|🥶 cold|" +
      "😱 scream|😨 fearful|🤗 hugging|🤔 thinking|🤭 hand over mouth|🤫 shushing|🤥 lying|😶 no mouth|" +
      "😐 neutral|😑 expressionless|😬 grimacing|🙄 eye roll|😯 hushed|😴 sleeping|🤤 drooling|" +
      "😪 sleepy|😵 dizzy|🤐 zipper mouth|🥴 woozy|🤢 nauseated|🤮 vomiting|🤧 sneezing|😷 mask|" +
      "🤒 thermometer|🤕 bandage|🤑 money mouth|🤠 cowboy|😈 smiling imp|👻 ghost|💀 skull|🤖 robot|" +
      "💩 poop|🤡 clown|👽 alien",
  ],
  [
    "People",
    "👍 thumbs up|👎 thumbs down|👏 clap|🙌 raised hands|👋 wave|🤝 handshake|🙏 pray|✌️ victory|" +
      "🤞 crossed fingers|🤟 love you|🤘 rock on|👌 ok hand|🤌 pinched fingers|👈 point left|" +
      "👉 point right|👆 point up|👇 point down|☝️ index up|✋ raised hand|🖐️ hand splayed|💪 muscle|" +
      "🫶 heart hands|👀 eyes|🧠 brain|🫡 salute|🤷 shrug|🤦 facepalm|🙋 raising hand|🙇 bow|" +
      "💁 tipping hand|🧑‍💻 technologist|🧑‍🎓 student|🧑‍🏫 teacher",
  ],
  [
    "Hearts",
    "❤️ red heart|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|" +
      "🖤 black heart|🤍 white heart|🤎 brown heart|💔 broken heart|❣️ heart exclamation|💕 two hearts|" +
      "💖 sparkling heart|💯 hundred|💢 anger|💥 boom|💫 dizzy star|💦 sweat drops|💬 speech|💭 thought",
  ],
  [
    "Nature",
    "🐶 dog|🐱 cat|🐭 mouse|🐰 rabbit|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|" +
      "🐷 pig|🐸 frog|🐵 monkey|🐔 chicken|🐧 penguin|🦉 owl|🦋 butterfly|🐢 turtle|🐍 snake|" +
      "🐙 octopus|🐬 dolphin|🐳 whale|🌵 cactus|🌲 tree|🌸 blossom|🌹 rose|🌻 sunflower|🍀 clover|" +
      "🌍 earth|🌙 moon|⭐ star|🌟 glowing star|☀️ sun|🌈 rainbow|🔥 fire|⚡ zap|❄️ snowflake|🌊 wave water",
  ],
  [
    "Food",
    "🍎 apple|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🍑 peach|🍍 pineapple|🥑 avocado|" +
      "🌽 corn|🍕 pizza|🍔 burger|🍟 fries|🌭 hotdog|🌮 taco|🍣 sushi|🍜 ramen|🍪 cookie|🎂 cake|" +
      "🍩 doughnut|🍫 chocolate|🍿 popcorn|☕ coffee|🍵 tea|🧃 juice|🍺 beer|🥂 cheers",
  ],
  [
    "Activities",
    "⚽ soccer|🏀 basketball|🏈 football|⚾ baseball|🎾 tennis|🏐 volleyball|🏓 ping pong|🎯 bullseye|" +
      "🎮 video game|🎲 dice|♟️ chess|🎨 art|🎵 music|🎸 guitar|🎹 piano|🎤 microphone|🎧 headphones|" +
      "🏆 trophy|🥇 gold medal|🎉 tada|🎊 confetti|🎁 gift|🎈 balloon",
  ],
  [
    "Objects",
    "📚 books|📖 open book|📝 memo|✏️ pencil|🖊️ pen|📎 paperclip|📌 pushpin|📅 calendar|⏰ alarm|" +
      "⌛ hourglass|💡 bulb|🔍 search|🔒 lock|🔑 key|💻 laptop|🖥️ desktop|📱 phone|⌨️ keyboard|" +
      "🖱️ mouse computer|💾 floppy|📷 camera|🎬 clapper|📊 chart|📈 trending up|📉 trending down|" +
      "🧪 test tube|🔬 microscope|🧮 abacus|💰 money bag|🚀 rocket|✈️ airplane|🚗 car|🏠 house",
  ],
  [
    "Symbols",
    "✅ check|☑️ ballot check|✔️ check mark|❌ cross|❎ cross button|⭕ circle|❗ exclamation|❓ question|" +
      "‼️ double exclamation|⚠️ warning|🚫 no entry|🔴 red circle|🟢 green circle|🔵 blue circle|" +
      "🟡 yellow circle|⬆️ up|⬇️ down|➡️ right|⬅️ left|🔁 repeat|🆗 ok|🆕 new|🔝 top|💤 zzz|" +
      "1️⃣ one|2️⃣ two|3️⃣ three|🇰🇪 kenya|🏁 checkered flag",
  ],
];

export const EMOJI_CATEGORIES: EmojiCategory[] = data.map(([name, list]) => ({
  name,
  emojis: list.split("|").map((entry) => {
    const space = entry.indexOf(" ");
    return { emoji: entry.slice(0, space), name: entry.slice(space + 1) };
  }),
}));

export const ALL_EMOJI: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "👀"];

const RECENT_KEY = "emoji.recent";

export function recentEmoji(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  try {
    const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: recents just won't persist
  }
}

export function searchEmoji(query: string): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_EMOJI;
  return ALL_EMOJI.filter((e) => e.name.includes(q));
}

export function emojiName(emoji: string): string {
  return ALL_EMOJI.find((e) => e.emoji === emoji)?.name ?? emoji;
}
