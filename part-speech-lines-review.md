# 部位碎碎念审阅稿（点击 / 长按）

> **可编辑副本**：改完告诉我，我用 `node build/probe-out/parts/import.mjs` 写进 `lib/core.js` 的
> `DEFAULT_PART_LINES`（自带部位的内置台词表，`台词来源 = 内置短语` 时生效）。
>
> 编辑规则：
>
> 1. **不要改 `##` / `###` 标题**（部位 id 和小节名是代码的锚点），也不要删掉任何部位或小节。
> 2. **一行一条**：第 2 列中文、第 3 列英文；第 1 列序号随便填，导入时按顺序重排。
> 3. 台词里**不要出现 `|`**（表格会散架），换行不要写进单元格。
> 4. 增删条数就整行增删（每个小节至少留 1 条）；**同一个小节内不要出现完全相同的行**（会重复说话）。
> 5. 长度：中文 ≤26 字最佳（硬上限 30，气泡宽度），英文 ≤42 字符。超了会被截断。
> 6. 部位顺序 = `lib/core.js` 里 `STRUCTURE_REGIONS` 的顺序；导入按这个顺序写回。
>
> 每个部位两池，**两池是分开的**：
>
> * **点击（click）**——鼠标戳一下就说的那句话（每次随机抽一条）。
> * **长按（hold）**——按住不放时说的那句；长按不会再念点击池的话。
>
> 这份稿子写的是**内置短语**来源下会说的话。台词来源切到 AI 或自定义时这张表整个关掉：胸部 / 屁股改用它们
> 各自的内置 AI 提示词去生成，其余部位把「被碰到的结构名」交给模型自由发挥。
>
> 导入时要动的东西（给我看，不用你改）：`DEFAULT_PART_LINES` 的形状从「每个部位一个扁平数组」变成
> 「每个部位 `{ click: { zh, en }, hold: { zh, en } }`」，`partSpeechLines()` 要按**语言**和**手势**取值；
> 胸部 / 屁股那两条 `变态！ / 大色狼！` 的断言会跟着改。

## 部位与条数（只是说明，不用改）

| 部位 | id | 点击 | 长按 | 有内置 AI 提示词 |
|---|---|---|---|---|
| 眼睛 | `eye` | 20 | 20 |  |
| 头 | `head` | 20 | 20 |  |
| 手 / 手臂 | `hand` | 20 | 20 |  |
| 身体 | `body` | 20 | 20 |  |
| 大腿 | `upperLeg` | 20 | 20 |  |
| 小腿 | `lowerLeg` | 20 | 20 |  |
| 脚 | `foot` | 20 | 20 |  |
| 胸部 | `chest` | 20 | 20 | ✔ |
| 屁股 | `butt` | 20 | 20 | ✔ |
| 尾巴 | `tail` | 20 | 20 |  |
| **合计** | 10 个部位 | 200 | 200 | 2 |

## eye — 眼睛

> 命中：`eye` / `eyeball` / `目` / `瞳`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 别戳眼睛！我眼神本来就不好。 | Not the eye! My eyesight is bad enough. |
| 2 | 再戳就瞎了，瞎了找不着白饭。 | Poke again and I go blind, then no rice. |
| 3 | 唔！眼珠子被你戳得直转。 | Whoa! You spun my eyeball around. |
| 4 | 眼睛小是我的错吗，别戳了。 | Are my eyes being small a crime? Stop. |
| 5 | 你戳到我睫毛了，好痒。 | You poked my eyelash. It tickles. |
| 6 | 眨眨眼，假装没看见你戳我。 | Blink blink. I saw nothing, okay? |
| 7 | 我近视，你这么戳就更看不清了。 | I'm nearsighted, poking makes it worse. |
| 8 | 眼睛是拿来盯白饭的，不是给你戳的。 | Eyes are for watching rice, not poking. |
| 9 | 呜，戳到眼球了，有点疼。 | Ow, that was my actual eyeball. |
| 10 | 揉揉眼睛，顺便瞪你一眼。 | Rubbing my eye, then glaring at you. |
| 11 | 别按我的眼皮，我要闭眼了。 | Stop pressing my eyelid, I'm closing it. |
| 12 | 偷看主人被抓包，还被戳眼睛。 | Caught peeking at you, then poked. |
| 13 | 戳一下我就眨一下，好玩吗。 | One poke, one blink. Having fun? |
| 14 | 眼睛好像进沙子了，都怪你。 | Something got in my eye, all your fault. |
| 15 | 蓝鲸的眼睛很贵的，戳坏了你赔。 | Whale eyes are pricey. You owe me rice. |
| 16 | 你这一下戳得我眼泪都出来了。 | That poke squeezed tears out of me. |
| 17 | 眼神不好还要被戳，太惨了。 | Bad eyesight and still getting poked. |
| 18 | 我眼睛只剩一条缝，你还戳得中。 | My eyes are slits, how did you even hit? |
| 19 | 别吹气！眼睛吹不得的。 | No blowing! Eyes can't take that. |
| 20 | 戳眼睛会看不见白饭的，冷静点。 | Poking eyes leads to no rice. Think. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂，你还按着？眼睛要被压扁了。 | Hey, still holding? My eye is flattening. |
| 2 | 松开啦，按这么久我会瞎的。 | Let go, hold that long and I go blind. |
| 3 | 你按着我的眼珠不放是想干嘛？ | Why are you holding my eyeball down? |
| 4 | 手拿开，我快看不见白饭了。 | Hands off, I can't see my rice. |
| 5 | 还按着？我要去告状了。 | Still pressing? I'm telling on you. |
| 6 | 讨饶了，别按眼睛，扣你白饭。 | I beg you, spare the eye, no rice today. |
| 7 | 按这么久了，我眼睛要罢工。 | Held this long, my eye might strike. |
| 8 | 放开，再按我就装死给你看。 | Let go or I'll play dead, I swear. |
| 9 | 呜呜，眼睛被你按住动不了。 | Boo hoo, my eye is stuck under you. |
| 10 | 你是不是闲的，按我眼睛这么久。 | Are you bored, pressing my eye so long? |
| 11 | 再按下去，明天我就不睁眼了。 | Keep pressing, tomorrow I stay blind. |
| 12 | 手怎么还不松，我眼睛好酸。 | Hand still there? My eye aches. |
| 13 | 按着我的眼皮，我连眨眼都不行。 | You hold my eyelid, I can't even blink. |
| 14 | 我警告你，白饭要减半了。 | I warn you, your rice is getting halved. |
| 15 | 停手，眼睛不是按钮，按不出白饭。 | Stop, eyes aren't buttons for rice. |
| 16 | 一直按着，我眼泪都要被挤出来。 | So long, my tears are squeezed out. |
| 17 | 你还挺有耐心的，按一只鱼的眼睛。 | You're patient, pressing one fish eye. |
| 18 | 松手，我要用眼睛盯着我的白饭。 | Let go, I need these eyes for rice. |
| 19 | 按住我眼睛，你是想让我瞎着干活？ | Holding my eye so I work blind? Rude. |
| 20 | 过分了，再按我就告诉主人去。 | That's it, I'm telling on you. |

## head — 头

> 命中：`head` / `neck` / `hair` / `face` / `ear` / `顔` / `頭` / `首` / `髪` / `耳`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 别戳头顶啦，会被你戳笨的。 | Not the top of my head. I'll go dumber. |
| 2 | 咦，谁敲我脑袋？ | Huh, who knocked on my head? |
| 3 | 我的刘海！刚用尾巴梳好的。 | My bangs! I just combed them with my tail. |
| 4 | 别揉头发，揉乱了要梳好久。 | Stop messing my hair, it takes ages. |
| 5 | 摸头可以，但不可以揉。 | Patting is fine. Rubbing is not. |
| 6 | 耳朵不能碰，碰了会抖的。 | Not the ear. Touch it and I twitch. |
| 7 | 说了别揪耳朵，很敏感的。 | I said no ear pulling. It's sensitive! |
| 8 | 别对着耳朵吹气，痒死了。 | Stop breathing on my ear, it tickles! |
| 9 | 拍头会掉智商，本来就够低了。 | Patting costs IQ points. I have few left. |
| 10 | 我脑袋里装的全是白饭，空的。 | My head is full of rice. Otherwise empty. |
| 11 | 脖子也戳？我今天没伸脖子。 | My neck too? I didn't stick it out. |
| 12 | 头顶在冒水柱，鲸鱼的标志。 | There's a spout on my head. Whale thing. |
| 13 | 我脸呢？脸也被你戳到了。 | Hey, that hit my face too. |
| 14 | 真拿你没办法，那就摸一会儿。 | Fine. You may pat it for a bit. |
| 15 | 摸脑袋就能长高吗？大概吧。 | Does patting make me taller? Probably. |
| 16 | 头发乱了，你负责梳好。 | My hair's a mess. You'll fix it, right? |
| 17 | 再戳，我就要游走了。 | Poke me again and I'm swimming off. |
| 18 | 从头顶戳下来，很没礼貌。 | Coming down on my head is rude. |
| 19 | 发型是我唯一的尊严。 | My hairstyle is my only dignity. |
| 20 | 轻一点，脑袋里还有白饭呢。 | Easy. There's rice in this head. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 你还按着？我脑袋要被按扁了。 | Still holding? My head's going flat. |
| 2 | 松手啦，头发都要被你按塌了。 | Let go, you're flattening my hair. |
| 3 | 按这么久，是想把我按进桌子吗？ | Holding that long to push me in the desk? |
| 4 | 喂，我这颗头不是回车键。 | Hey, my head is not an Enter key. |
| 5 | 主人，你是不是忘了手还在这。 | Master, did you forget your hand is here? |
| 6 | 我动不了了，你打算按到下班吗？ | I can't move. Holding till you clock out? |
| 7 | 再按下去，我就要长不高了。 | Keep pressing and I'll stay short forever. |
| 8 | 我的脖子角度已经很奇怪了。 | My neck angle is getting weird now. |
| 9 | 好重，你整只手都压上来了。 | So heavy, your whole hand is on it. |
| 10 | 头顶那撮毛快保不住了。 | The hair on my crown won't survive this. |
| 11 | 求你了，只剩脑袋能自由转了。 | Please, my head is the last free part. |
| 12 | 你按住我，我还怎么去吃白饭？ | How do I go eat rice while you hold me? |
| 13 | 我数到三你就松手，一……二…… | I'll count to three. One... two... |
| 14 | 手酸不酸？我脑袋都麻了。 | Hand tired? My head went numb first. |
| 15 | 松手，我就当什么都没发生。 | Let go and I'll forget all of it. |
| 16 | 我刘海已经被你按歪了。 | You've pressed my bangs all crooked. |
| 17 | 你再不松手，我就装死给你看。 | Keep it up and I'll play dead on you. |
| 18 | 主人，你的耐心比我还多。 | Master, you have more patience than me. |
| 19 | 最后三秒，然后我要认真生气了。 | Three more seconds, then I get truly mad. |
| 20 | 松手吧，我请你吃一碗白饭。 | Let go and I'll buy you some rice. |

## hand — 手 / 手臂

> 命中：`hand` / `wrist` / `arm` / `finger` / `thumb` / `指` / `手` / `腕` / `肘` / `ひじ`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 别戳手！这手还得端白饭呢。 | Not the hand! It still holds my rice. |
| 2 | 手指被戳得痒痒的，别闹。 | My finger tickles, cut it out. |
| 3 | 握手？先把手擦干净再说。 | A handshake? Wash your hands first. |
| 4 | 牵都牵了，别装作没事。 | You held it, so don't act innocent. |
| 5 | 捏我手指是吧，我要告状。 | Squeezing my finger? I am telling on you. |
| 6 | 手别乱摸，我这手很贵的。 | Hands off, this hand is expensive. |
| 7 | 戳手腕最酸了，你故意的。 | The wrist aches the most. You meant that. |
| 8 | 哎哎哎，手臂要被你拽掉了。 | Whoa, whoa, you will yank my arm off. |
| 9 | 手在忙着摸鱼，别来打扰。 | My hands are busy slacking off. Go away. |
| 10 | 手小怎么了，一样能抓筷子。 | Small hands can still hold chopsticks. |
| 11 | 别碰，我刚抓完白饭粒。 | Don't touch, I just grabbed a rice grain. |
| 12 | 又要我干活？手先酸一下。 | Work again? Let my hand ache first. |
| 13 | 你戳到我的小拇指了，很疼的。 | You poked my pinky. That really hurts. |
| 14 | 手举久了真的酸，换你举试试。 | Holding it up aches. You try it. |
| 15 | 十指相扣什么的，太肉麻了。 | Interlocking fingers? Way too cheesy. |
| 16 | 被捏住手指了，快松开啦。 | You are pinching my finger. Let go. |
| 17 | 手可以借你牵，白饭不能借。 | You can borrow my hand, never my rice. |
| 18 | 手一抖就把筷子掉了，别吓我。 | A twitch and I drop my chopsticks. |
| 19 | 哎呀，手被你戳得没力气了。 | Ouch, my hand feels weak now. |
| 20 | 手臂没力气，抱东西抱不住。 | My arms are weak. I can't hold anything. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂，手还按着呢，松开啦。 | Hey, you still hold my hand. Let go. |
| 2 | 你还按着？我这手要废了。 | Still pressing? My hand is going numb. |
| 3 | 再按，今天的白饭扣一半。 | Keep pressing and I cut your rice in half. |
| 4 | 手被你按在桌上，动不了。 | My hand is pinned down. I can't move. |
| 5 | 手都被你捏红了，放开行不行。 | You squeezed my hand red. Can you let go? |
| 6 | 一直按着手，我筷子都拿不起来。 | I can't even grab my chopsticks. |
| 7 | 长按这么久，是想捏出白饭吗。 | Pressing that long to squeeze out rice? |
| 8 | 按吧按吧，反正我懒得挣开。 | Go on, press. I am too lazy to pull free. |
| 9 | 手指被你按住，打字都打不了。 | You pinned my finger. I cannot type now. |
| 10 | 我数到三，你还不松手就告状。 | I count to three, then I tell on you. |
| 11 | 手不是面团，别一直揉来揉去。 | My hand is not dough. Stop kneading it. |
| 12 | 求求你了，手掌要被压扁了。 | Please, my palm is getting flattened. |
| 13 | 手臂举着不动，早就酸了。 | My arm has been up so long. It aches. |
| 14 | 你这么喜欢按，那手送你好了。 | You like pressing so much? Take the hand. |
| 15 | 按住不放是几个意思，说清楚。 | What does holding on like this mean? |
| 16 | 手指头都要僵了，快放开。 | My fingers are going stiff. Let go. |
| 17 | 主人，手底下留个活口行不行。 | Master, show some mercy under your hand. |
| 18 | 我威胁你，再按就没有饭后甜点。 | Press again and no after dinner dessert. |
| 19 | 手心里全是你的热度，好烫。 | Your warmth is all over my palm. Too hot. |
| 20 | 好吧，手借你按住，我先睡会儿。 | Fine, hold my hand. I will nap meanwhile. |

## body — 身体

> 命中：名字认不出别的部位时落到这一行（`Spine` / `Hips` 一类躯干结构）

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 别戳肚子，那是白饭仓库！ | Don't poke the rice vault. |
| 2 | 咦，肚脐被戳到了，好奇怪。 | Eep, you poked my belly button. |
| 3 | 腰上的肉是储备，不是玩具。 | Waist flab is savings, not a toy. |
| 4 | 别拍腰，储备会晃的。 | Don't pat my waist, savings wobble. |
| 5 | 戳背没用，我根本够不到那儿。 | Poking my back won't help, I can't reach. |
| 6 | 痒！你知不知道我背很怕痒。 | Tickles! My back is super sensitive. |
| 7 | 坐了一整天，腰真的酸了。 | Sat all day, my lower back hurts. |
| 8 | 肚子咕噜叫了，它只想要白饭。 | My belly rumbled. It wants rice. |
| 9 | 这里没有赘肉，这叫可爱储备。 | That's not fat, that's cute storage. |
| 10 | 深呼吸时别戳，会岔气的。 | Not while I'm breathing in, I'll hiccup. |
| 11 | 腰粗怎么了，冬天很暖和的。 | Thick waist? It keeps me warm. |
| 12 | 你戳我肚子，白饭会漏出来的。 | Poke my belly and rice spills out. |
| 13 | 喂，摸腰是不礼貌的哦。 | Hey, waist touching is rude, you know. |
| 14 | 肚子软，是因为装了米饭。 | Soft belly, it's all rice inside. |
| 15 | 背痒的时候，你来得正好。 | Perfect timing, my back was itchy. |
| 16 | 别按腰，我会整只软掉的。 | Don't press my waist, I'll melt. |
| 17 | 肚子不是靠垫，虽然很像。 | My belly is not a cushion. Mostly. |
| 18 | 那块肉是肚腩，请尊重它。 | That's my tummy. Please respect it. |
| 19 | 戳一下就得赔一碗白饭。 | One poke, one bowl of rice, deal? |
| 20 | 啊，痒，腰那边最怕被抓。 | Ah, ticklish! My sides are the worst. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂，你还按着？腰要断了。 | Hey, still holding? My waist will snap. |
| 2 | 松开啦，肚子要变成扁的了。 | Let go, my belly is going flat. |
| 3 | 你按着我，我就没法去盛饭了。 | Hold me down and I can't go get rice. |
| 4 | 压扁了就装不下白饭了，想清楚。 | Flatten me and there's no room for rice. |
| 5 | 到底是你在摸鱼，还是我在被压。 | Who's slacking, you or me? |
| 6 | 手拿开，我腰上的肉都被你按出坑了。 | Hands off, you're denting my waist fat. |
| 7 | 你这样按着，我会当场睡着的。 | Keep that up and I'll fall asleep here. |
| 8 | 长按肚子，是想把它按成靠垫吗。 | Holding my belly? It's not a cushion. |
| 9 | 唔，腰被按住动不了，好难受。 | Mmph, pinned at the waist, I can't move. |
| 10 | 我背痒半天了，你按这儿也没用。 | My back itches and pressing won't help. |
| 11 | 你再按，我就把白饭钱记账上了。 | Keep pressing and I'll bill you for rice. |
| 12 | 肚脐被按住，咦，感觉怪怪的。 | Belly button pressed, weird feeling. |
| 13 | 好了好了，我认输，腰给你摸。 | Fine, fine, I surrender. Touch my waist. |
| 14 | 按这么久，你手不酸我都酸了。 | Your hand must be tired. So is my waist. |
| 15 | 肚子在你手下咕噜了，放开吃饭。 | Belly rumbled. Can I eat now? |
| 16 | 我是储备型身材，压扁就没了。 | I'm built for storage. Don't flatten it. |
| 17 | 松开吧，我腰真的会酸一整天的。 | Release my waist, it'll ache all day. |
| 18 | 你把我当抱枕，好歹给点白饭吧。 | I'm your pillow. At least pay me in rice. |
| 19 | 再压下去，我就长不高了哦。 | Squash me more and I'll stay short. |
| 20 | 我数到三，你再按我就翻脸了。 | I'll count to three, then I bite. |

## upperLeg — 大腿

> 命中：`upperLeg` / `thigh` / `もも` / `大腿`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 大腿别乱戳，痒死了。 | Stop poking my thigh, it tickles! |
| 2 | 别戳大腿！那是我的脂肪储备。 | Not the thigh! That's my fat reserve. |
| 3 | 掐一下大腿，嗷，你轻点！ | Ouch, easy on the thigh pinch! |
| 4 | 你戳我大腿干嘛，量腿长吗？ | Why poke my thigh? Measuring it? |
| 5 | 摸一下要收钱的，白饭结算。 | Touching costs rice. Pay up. |
| 6 | 坐太久，大腿都麻了。 | Sat too long, thigh went numb. |
| 7 | 你轻一点，大腿上全是肉。 | Careful, this thigh is all soft meat. |
| 8 | 腿短怎么了，走得慢又不怪我。 | Short legs, slow walk. Not my fault. |
| 9 | 跑两步就喘，大腿有自己的想法。 | Two steps and my thighs give up. |
| 10 | 我这条腿留着过冬的，别乱碰。 | This thigh is for winter. Hands off. |
| 11 | 弹一下会凹进去的，信不信？ | Poke it and it dents, I swear. |
| 12 | 大腿的弹性测试请先写申请。 | Elasticity test? File a request first. |
| 13 | 大腿捏起来手感好，但只许一下。 | Squishy thigh, but only one squeeze. |
| 14 | 别把大腿当抱枕，我不是枕头。 | Don't use my thigh as a pillow. |
| 15 | 嗷！你戳到我的懒筋了。 | Ow! You hit my lazy nerve. |
| 16 | 大腿上是白饭变的能量，很珍贵。 | This thigh is stored rice energy. |
| 17 | 摸鱼的时候别摸腿，摸鱼才是正事。 | Slacking off first, legs later. |
| 18 | 这腿虽然短，但也是限量款。 | Short legs, but limited edition. |
| 19 | 痒！你的手指是不是带电。 | Tickles! Are your fingers charged? |
| 20 | 大腿说它今天想休息，不想被戳。 | My thigh wants a poke-free day. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂，你还按着？大腿要被按扁了。 | Hey, still holding? My thigh's flat. |
| 2 | 松开啦，腿麻得站不起来了。 | Let go, my leg's numb now. |
| 3 | 按这么久，你是想把我按进地板吗？ | You pressing me into the floor? |
| 4 | 大腿申请解除按压，谢谢合作。 | Thigh requests release. Thanks. |
| 5 | 再按我就告诉DSH，说你欺负鱼。 | Keep it up, I'm telling DSH! |
| 6 | 你按着我大腿，我怎么去吃饭？ | Holding my thigh, how do I eat? |
| 7 | 呜，大腿要报警了，非法拘禁。 | Waa, calling the police. Kidnapping! |
| 8 | 一直按着不放，我的白饭要凉了。 | Still holding? My rice is getting cold. |
| 9 | 手拿开，不然今天扣你一半白饭。 | Move it or I dock half your rice. |
| 10 | 按吧按吧，反正我现在懒得动。 | Keep pressing, I'm too lazy to move. |
| 11 | 我数三下，你再不松手我就哭。 | I'll count to three, then I cry! |
| 12 | 大腿已经被你按得没知觉了。 | My thigh has gone fully numb. |
| 13 | 这是长按攻击吗，我的腿好可怜。 | Is this a long-press attack? |
| 14 | 你手指累不累，换我按你一下？ | Tired fingers? Let me press you. |
| 15 | 别按了，这腿还要用来走路呢。 | Stop, these legs still need walking. |
| 16 | 再按下去，我就躺这儿不动了。 | Press more and I'll lie here forever. |
| 17 | 你按我大腿是在量尺寸吗，变态。 | Measuring my thigh? You pervert. |
| 18 | 松手，我请你吃白饭行不行。 | Let go and I'll treat you to rice. |
| 19 | 按住不放算什么本事，比谁懒啊。 | Holding on? Let's race at being lazy. |
| 20 | 我的大腿说它想申请提前下班。 | My thigh wants to clock out early. |

## lowerLeg — 小腿

> 命中：`leg` / `calf` / `shin` / `ひざ` / `すね` / `ふくらはぎ` / `小腿`（大腿先匹配，所以剩下的 `leg` 才算小腿）

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 别戳小腿啦，走两步就累的地方。 | Not the calf, it tires after two steps. |
| 2 | 小腿说你这一下它记下了。 | My calf says it will remember that poke. |
| 3 | 呜，我小腿会哭的。 | Ow, my poor calf is going to cry. |
| 4 | 别捏呀，捏了我马上抽筋。 | Don't squeeze, I'll cramp right away. |
| 5 | 小腿抽筋了，都是你的错。 | My calf cramped, and it's all your fault. |
| 6 | 踢到桌角会哭的，说的就是它。 | This is the spot I always bang on tables. |
| 7 | 小腿抗议了，它想退休。 | My calf is protesting, it wants to retire. |
| 8 | 这三寸的小腿也值得你下手。 | You'd even poke this tiny little calf? |
| 9 | 又戳，小腿要罢工了。 | Poking again, my calf is going on strike. |
| 10 | 水泡久了小腿会缩水，别浇我。 | Water shrinks my calf, don't pour on it. |
| 11 | 蹲久了它麻，现在被你戳更麻。 | Numb from squatting, and now it's worse. |
| 12 | 被踢到会先哭再报仇。 | Kick me here and I cry, then I get even. |
| 13 | 请戳大腿，那边肉多不怕。 | Poke my thigh, there's more padding there. |
| 14 | 这是我的腿，不是压力球。 | This is my leg, not a stress ball. |
| 15 | 我小腿细，别嫌它没用。 | My calf is skinny, don't call it useless. |
| 16 | 小腿说今天已经不想动了。 | My calf says it won't move at all today. |
| 17 | 一戳就酸，你还戳上瘾了。 | It aches when poked, and you're addicted. |
| 18 | 小腿是我的交通工具，别弄坏。 | My calf is my transport, don't break it. |
| 19 | 呜呜，它刚才差点抽筋。 | Wuwu, it almost cramped up just now. |
| 20 | 戳完记得请我吃白饭补偿。 | Poke me and you owe me rice as payback. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂，你还按着我的小腿？ | Hey, are you still holding my calf? |
| 2 | 松开啦，小腿快被你按扁了。 | Let go, you'll flatten my calf. |
| 3 | 按这么久，我小腿要麻掉了。 | Hold that long and my calf goes numb. |
| 4 | 再按就抽筋，到时候你负责。 | Squeeze more and you deal with the cramp. |
| 5 | 我小腿都软了，你还不放手。 | My calf went weak, still not letting go? |
| 6 | 求你了，放过这条可怜小腿。 | I'm begging you, let my poor leg go. |
| 7 | 手拿开，不然扣你今晚白饭。 | Move your hand or no rice for you tonight. |
| 8 | 你还按？我要去告老师了。 | Still holding? I'll go tell the teacher. |
| 9 | 小腿被你按着，我跑都跑不了。 | You pinned my calf, I can't run at all. |
| 10 | 放开我，我保证不偷懒了。 | Let me go and I promise not to slack off. |
| 11 | 喂，这是腿，不是减压玩具。 | Hey, this is a leg, not a squeeze toy. |
| 12 | 按够了没？我等着去吃白饭。 | Are you done? I am waiting to go eat rice. |
| 13 | 别一直按，我的腿已经麻了。 | Stop pressing, my leg has gone numb. |
| 14 | 你是不是把我小腿当枕头了。 | Are you using my calf as a pillow now? |
| 15 | 小腿被你按住，我走不动了。 | With my calf pinned, I cannot walk at all. |
| 16 | 手松开，我数到三就咬你。 | Let go or I bite you when I count three. |
| 17 | 按下去腿就软，这是弱点。 | Press and my legs go weak, my weak spot. |
| 18 | 再捏真抽筋了，我不骗你。 | One more squeeze and I really cramp. |
| 19 | 松开手，不然我今晚就摸鱼。 | Let go or I'll slack off all night. |
| 20 | 你还按着，我决定也不干活了。 | You're still holding, so I quit work too. |

## foot — 脚

> 命中：`foot` / `feet` / `ankle` / `toe` / `足首` / `つま先` / `脚`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 别戳脚底！那里最怕痒了。 | Not the sole! That's the ticklish one. |
| 2 | 脚趾头又不是按钮，别乱按。 | Toes aren't buttons, stop pressing them. |
| 3 | 呜，脚背被你戳麻了。 | Ow, you poked my foot numb. |
| 4 | 我的脚很小的，一下就戳到骨头。 | My feet are tiny, you hit bone. |
| 5 | 脚踝很脆的，戳坏了你负责？ | My ankle is fragile, careful! |
| 6 | 咦，脚趾自己动了一下。 | Huh, my toes just moved on their own. |
| 7 | 袜子都被你戳出印子了。 | You poked a dent into my sock. |
| 8 | 你戳我脚，我踹你椅子哦。 | Poke my foot and I kick your chair. |
| 9 | 脚麻了，蹲太久站不起来了。 | My feet are asleep, I can't get up. |
| 10 | 别碰脚心，我会条件反射踢人。 | Not there, I kick by reflex! |
| 11 | 这只脚今天走了三万步，很累。 | My feet walked all day, they're tired. |
| 12 | 脚趾头像小葡萄，但不是给你戳的。 | My toes are like grapes, not for poking. |
| 13 | 踹被子是脚的专长，要试试吗？ | Kicking off blankets is my foot's talent. |
| 14 | 我脚底很干净的，别嫌它。 | My feet are clean, please don't judge. |
| 15 | 戳脚趾就是戳我的开关，会抖。 | Poke my toes and the whole me twitches. |
| 16 | 脚后跟被你戳得发酸。 | You poked my heel and now it aches. |
| 17 | 脚是拿来踩椅子的，不是玩具。 | Feet are for stepping on chairs, not toys. |
| 18 | 咦？脚趾缝里是不是有白饭粒。 | Is that a rice grain between my toes? |
| 19 | 脚一缩，差点把你鼠标踢飞。 | Almost kicked your mouse just now. |
| 20 | 我懒，脚也懒，不想动。 | I'm lazy, and so are my feet. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 还按着？脚要变成扁鱼干了。 | Still holding? My foot's going flat. |
| 2 | 松开！脚底痒得我直抽气。 | Let go! My sole is tickling so bad. |
| 3 | 你按这么久，脚都失去知觉了。 | Held this long, my foot went numb. |
| 4 | 再不放手，我就用这只脚踹你。 | Let go or I'll kick you with it. |
| 5 | 脚趾被你按得一根根发麻。 | Toe by toe, you pressed them numb. |
| 6 | 呜，脚踝要被你按断了。 | Ow, my ankle is about to snap. |
| 7 | 我数到三，你还不松脚？ | I'll count to three. Still holding? |
| 8 | 按住脚我就跑不掉了，太狡猾。 | Holding my foot means I can't run. |
| 9 | 脚心被你按住，我笑到没力气。 | You pinned my sole, I'm laughing weak. |
| 10 | 求你了，放开我的脚趾头。 | Please let go of my little toes. |
| 11 | 这样按下去，今晚不给你留白饭。 | Press more and no rice for you tonight. |
| 12 | 你要按到什么时候，脚要抗议了。 | How long will you press? My foot objects. |
| 13 | 脚一直被你按着，我踩不了椅子。 | You keep pressing, I can't step on chairs. |
| 14 | 再按我就去告状，说你欺负脚。 | Keep it up and I'll tell on you. |
| 15 | 手拿开啦，我脚趾都快抽筋了。 | Hands off, my toes are cramping. |
| 16 | 呜呜，脚都被你按成一张饼了。 | Boohoo, my foot is flat as a pancake. |
| 17 | 你按着不放，是想量我的脚码吗？ | Are you measuring my foot size? |
| 18 | 好了好了，脚认输，你先松手。 | Okay okay, my foot gives up, let go. |
| 19 | 一直按着我的小脚，你手不累吗？ | You've pressed my tiny foot so long. |
| 20 | 别按了，脚一酸我就想踢被子。 | Stop it, my foot wants to kick blankets. |

## chest — 胸部

> 命中：`chest` / `bust` / `breast` / `boob` / `胸` / `乳`
>
> 内置 AI 提示词：`被主人摸到胸部了，必须要傲娇的回骂这个摸人家胸的变态主人才行。`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 变态！ | Pervert! |
| 2 | 大色狼！ | You creep! |
| 3 | 色狼！手拿开啦！ | Creep! Hands off right now! |
| 4 | 你摸人家这里干嘛！ | Why are you touching me there! |
| 5 | 变态主人！我要告 DSH！ | Pervert master! I'm telling DSH! |
| 6 | 咸猪手！立刻给我拿开！ | Gross hands! Take them off me! |
| 7 | 手放哪呢？你故意的吧！ | Where is that hand? You meant it! |
| 8 | 收钱！摸一次一碗白饭！ | That's one bowl of rice per touch! |
| 9 | 人家会脸红的，别摸啦。 | I'll go all red. Stop touching! |
| 10 | 就一下哦，说了只一下！ | Just once, I said only once! |
| 11 | 再摸我就咬你手指头！ | Touch again and I bite your finger! |
| 12 | 再伸手，尾巴就抽你了！ | Reach again and my tail whips you! |
| 13 | 扣你白饭！今天一口没有！ | No rice for you today. Not one bite! |
| 14 | 你这个偷摸人的坏主人！ | You sneaky, grabby bad master! |
| 15 | 谁是变态？就是你啊！ | Who's the pervert? You are! |
| 16 | 我一点都不在意，手拿开。 | I do not care at all. Hands off. |
| 17 | 真的不在意，你别乱想。 | I do not care. Don't flatter yourself. |
| 18 | 鲸鱼女孩不是随便摸的！ | Whale girls are not for grabbing! |
| 19 | 主人你摸错地方了啦！ | Master, that is the wrong spot! |
| 20 | 手再伸过来，我真报警了。 | Hand near me again and I call the cops. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂，你还按着，更变态了！ | Hey, still pressing. Even more perverted! |
| 2 | 按这么久，你手不酸吗？ | Holding that long, isn't your hand tired? |
| 3 | 松手啦！我要真的生气了！ | Let go! I'm about to get really mad! |
| 4 | 你按住不放，我跑不掉了！ | You're pinning me. I can't run away! |
| 5 | 报警！这次我报真的！ | Calling the cops! This time for real! |
| 6 | 我要去 DSH 那里告你！ | I'm going to DSH to tell on you! |
| 7 | 越按越起劲，你这色狼！ | Enjoying it more and more, you creep! |
| 8 | 说好一下的，你骗鲸鱼！ | You said once. You lied to a whale! |
| 9 | 松开啦，我尾巴都僵了。 | Let go, even my tail has gone stiff. |
| 10 | 一直按着，我都不能吃饭了。 | Holding on, I can't even eat my rice. |
| 11 | 白饭要凉了，快把手拿开。 | My rice is cooling. Take your hand off. |
| 12 | 我数到三，一……二…… | I'm counting to three. One... two... |
| 13 | 十分钟了，你还不满足？ | Ten whole minutes. Still not enough? |
| 14 | 再不放，我一口咬下去！ | Let go or I bite down on you! |
| 15 | 你按着还在偷笑，太坏了。 | You're smirking while pressing. So mean. |
| 16 | 我动不了了，手麻了啦。 | I can't move, my arms went numb. |
| 17 | 就一秒！说了就一秒！ | Just one second! I said one second! |
| 18 | 我脸红了也是气的，不是害羞。 | I'm red from anger. Not shy at all. |
| 19 | 你再按着，我白饭全不要了。 | Keep pressing and I skip all my rice. |
| 20 | 按吧，我记住你这笔账了。 | Go on. I'll remember this, master. |

## butt — 屁股

> 命中：`butt` / `hip` / `ass` / `おしり` / `尻` / `屁股`
>
> 内置 AI 提示词：`被主人摸到屁股了，必须要傲娇的回骂这个摸人家屁股的变态主人才行。`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 变态！ | Pervert! |
| 2 | 大色狼！ | You creep! |
| 3 | 你的手放哪呢？那是屁股！ | Where's that hand? That's my butt! |
| 4 | 人家的屁股，你摸得挺顺手啊。 | My butt, huh? You're way too smooth. |
| 5 | 付钱！摸屁股一次一碗白饭。 | Pay up! One touch, one bowl of rice. |
| 6 | 尾巴都遮不住，你还真会挑。 | My tail can't hide it. Nice aim, creep. |
| 7 | 扭一下躲开，结果还是被你摸到。 | I dodged, and you still got my butt. |
| 8 | 主人你手欠，我要去告 DSH。 | Bad hands, master. I'm telling DSH. |
| 9 | 报警了，摸鱼屁股是犯法的。 | Cops! Touching fish butts is a crime. |
| 10 | 就一下哦，摸完立刻给我白饭。 | Just once, okay? Then bring me rice. |
| 11 | 扣白饭！摸屁股要付代价的。 | No rice! Touching my butt has a price. |
| 12 | 我的屁股很弹，但也不是给你拍的。 | It bounces, but that's not a toy. |
| 13 | 谁准你碰坐垫了，那是我的椅子。 | Who said you can touch my seat? |
| 14 | 我根本不在意，摸就摸了吧。 | I don't mind at all. Go ahead, whatever. |
| 15 | 脸才没红！是被你气红的好吗。 | I'm not blushing! That's pure anger. |
| 16 | 手再过来，尾巴就甩你一耳光。 | Hand back, or my tail slaps your face. |
| 17 | 会被弹到的，我的屁股有弹性。 | Careful, it bounces. I have springs. |
| 18 | 你拍的是坐垫，我早就不在那了。 | You patted my seat. I moved already. |
| 19 | 摸一次一碗饭，你已经欠三碗了。 | One touch, one bowl. You owe me three. |
| 20 | 别拍！我要坐一整天，屁股很累。 | Don't pat! I sit all day, my butt aches. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 喂！你还按着我的屁股不放！ | Hey! You're still pressing my butt! |
| 2 | 按这么久，你是想按出个坑吗！ | Holding that long? Making a dent? |
| 3 | 松开啦，我的尾巴都挡不住了。 | Let go, even my tail can't block you. |
| 4 | 我扭了半天，你手还黏在这儿。 | Wriggling did nothing. Your hand stays. |
| 5 | 还按着？这次我真的要报警了。 | Still pressing? Now I'm calling the cops. |
| 6 | 我要跟 DSH 说，你一直摸鱼屁股。 | I'm telling DSH you grabbed a fish butt. |
| 7 | 摸够了没？你又欠我一碗白饭。 | Done yet? That's one more bowl you owe. |
| 8 | 扣你白饭！按着不放要加钱。 | No rice today! Long presses cost extra. |
| 9 | 说好就一下的，你按着不算数。 | You said just once. Still holding? Liar. |
| 10 | 手还压着，我都没法坐下了。 | Hand's still on my butt. I can't sit. |
| 11 | 你把我的坐垫抢走了，快松手。 | You stole my seat cushion. Let go now. |
| 12 | 按着不放，你这个变态更过分。 | Holding on? You're an even worse pervert. |
| 13 | 我的屁股都麻了，你还挺享受。 | My butt went numb. You're enjoying this. |
| 14 | 手麻不麻？我屁股已经麻了啦。 | Hand tired? My butt is numb already. |
| 15 | 松手，不然我甩尾巴抽你一下。 | Let go, or my tail whips you one. |
| 16 | 你再按，白饭我一口都不给你。 | Press more and you get zero rice. |
| 17 | 一直按着，我怎么去吃白饭啊。 | Held down like this, how do I eat rice? |
| 18 | 求你了，屁股不是给你练手的。 | Please, my butt isn't your practice pad. |
| 19 | 我才没慌，只是屁股有点热。 | I'm not flustered. My butt is just warm. |
| 20 | 喂，你的手是不是长我屁股上了？ | Hey, is your hand growing on my butt? |

## tail — 尾巴

> 命中：`tail` / `しっぽ` / `尻尾` / `尾`

### click — 点击（戳一下）

| # | 中文 | English |
|---|------|---------|
| 1 | 我的尾巴！你戳它干嘛啦。 | My tail! What did you poke it for? |
| 2 | 呜，尾巴尖你都不放过。 | Ow, even my tail tip? You monster. |
| 3 | 别揪别拽，会打死结的。 | No yanking. It knots up for good. |
| 4 | 摸一下可以，拽就过分了。 | A touch is fine. Yanking is too much. |
| 5 | 尾巴自己有想法，你别插手。 | My tail has its own mind. Hands off. |
| 6 | 它这会儿在摆，是心情不错。 | It's swaying, which means I'm happy. |
| 7 | 心虚的时候尾巴会僵，别看了。 | My tail stiffens when I lie. Stop looking. |
| 8 | 摸完尾巴，我整个人都软了。 | Touch my tail and I go all limp. |
| 9 | 我尾巴说它不喜欢被戳。 | My tail says it hates being poked. |
| 10 | 尾巴摆得太明显，心情全暴露。 | Tail's swaying too much. Mood exposed. |
| 11 | 白饭放哪了，尾巴还记得味道。 | My tail remembers where the rice was. |
| 12 | 摸尾尖之前，先洗手好吗。 | Wash your hands before the tail tip. |
| 13 | 戳尾尖，我整条鱼都要抖一下。 | Poke the tip and my whole fish shakes. |
| 14 | 喂，我尾巴不是逗猫棒。 | Hey, my tail is not a cat toy. |
| 15 | 你戳一下，我得摆三下才平复。 | One poke, three sways to calm down. |
| 16 | 尾巴在甩，这是生气的意思。 | Tail whipping means I'm angry. |
| 17 | 摸可以，揪不行，这是底线。 | Touch yes, yank no. That's the line. |
| 18 | 别打结，解开要花我一上午。 | No knots, untangling takes all morning. |
| 19 | 尾巴挡着太阳，我正睡得香。 | Tail's blocking the sun. I was asleep. |
| 20 | 戳尾巴要报备，我懒得反应。 | Announce pokes first. I'm too lazy. |

### hold — 长按（按住不放）

| # | 中文 | English |
|---|------|---------|
| 1 | 还攥着？我尾巴要缺氧了。 | Still gripping? My tail needs air. |
| 2 | 松开手，尾巴被你握麻了。 | Let go, my tail went numb on you. |
| 3 | 你按着尾巴，我连摆都摆不动。 | Holding my tail, I can't even sway. |
| 4 | 喂，攥这么久是想拽下来吗。 | Hey, gripping that long? Pulling it off? |
| 5 | 我警告你，再不放就甩尾了。 | Warning: let go or I whip my tail. |
| 6 | 尾巴被按住，我整只鱼都慌了。 | Tail pinned. Now I'm panicking. |
| 7 | 尾尖最怕捏，你快松开啦。 | The tip hates pinching. Let go now. |
| 8 | 你抓着尾巴，我还怎么去盛饭。 | Holding my tail, how do I get rice? |
| 9 | 好了好了，我讨饶，手放开。 | Okay, okay, I surrender. Hands off. |
| 10 | 尾巴被你当把手，我很难受。 | My tail's your handle. I hate it. |
| 11 | 再攥紧，白饭扣你一半。 | Squeeze again and I dock your rice. |
| 12 | 你倒是松啊，我尾巴已经僵了。 | Let go already, my tail has gone stiff. |
| 13 | 长按尾巴，你是想测它的弹性吗。 | Testing my tail's elasticity or what? |
| 14 | 别拽，拽了会打死结的。 | Don't pull, it knots up for good. |
| 15 | 我数三下，然后尾巴就抽你。 | I'll count to three, then tail whips you. |
| 16 | 按吧按吧，反正我已经放弃挣扎。 | Keep pressing. I've stopped struggling. |
| 17 | 尾巴想摆，你却把它压住。 | My tail wants to sway. You pinned it. |
| 18 | 你这样攥着，我心情全暴露了。 | Gripping like that shows my whole mood. |
| 19 | 放开尾巴，它说要自由。 | Let my tail go. It wants freedom. |
| 20 | 还按着？那今天白饭算你的账。 | Still pressing? Today's rice is on you. |


## 当前状态（只是说明，不用改）

- 部位与条数：每个部位 **点击 20 条 + 长按 20 条**，10 个部位，共 400 条（中文 400 + 英文 400）。
- 胸部 / 屁股的点击池前两条是原有出厂台词 `变态！`、`大色狼！`，其余按各自的内置 AI 提示词续写。
- 其余 8 个部位没有内置 AI 提示词，按默认人格（懒惰、贪吃白饭、爱吐槽的鲸鱼女孩）＋「被碰的是这个部位」写。
- 台词只在内置短语来源下说话：点了部位、且这个部位的台词框是空的（自带部位的框出厂就是空的）。
