# SoK: PCG across game genres

> 不同游戏类型里 PCG 分别生成什么、靠什么保证可玩、在一周 HTML+JS 的约束下哪种类型最值得做。

## 1. Problem & Scope

上一份 SoK 比较了同一类游戏（网格地图）里的 PCG 算法。这份换一个轴：**固定算法不谈，比较 PCG 在不同游戏类型里的角色**。每个类型选一个有公开资料的代表作，行是「类型（代表作）」，列是评估属性。

**Context**
- Audience: NYU Game Design week 4 小组，README 需要讲清 PCG 怎么工作、给游戏加了什么
- Time horizon: 一周内可交付的浏览器原型（HTML+JS，rot.js 可用）
- Out of scope: 机器学习类 PCG、多人在线、3D 引擎实现细节

## 2. Dimensions

行（11 个类型/代表作）在三张表里重复出现，每张表评估一个独立的轴：

1. **Content layer**：这个类型里 PCG 实际生成的是什么（空间、地形、遭遇、物品、谜题、任务、美术）
2. **Architecture & guarantee**：生成架构是什么（纯程序化、手工块拼装、运行时自适应），可玩性靠什么保证
3. **Prototype feasibility**：在一周 HTML+JS 内做出来、并在 README 里讲清楚的代价

正交性说明：同一个类型可以在轴 1 选「生成空间」，在轴 2 选「手工块拼装」，互不冲突。轴 3 是对前两轴选择的成本评估，不是独立的技术选择，这一点是本文结构上的弱点，见 §10。

## 3. Dimension 1: Content layer

### Properties
- **A 空间/布局**：房间、地图图结构、赛道几何
- **B 地形/世界**：连续地形、星球、资源分布
- **C 遭遇/敌人**：怪物放置、刷怪节奏
- **D 物品/战利品**：装备、道具、补给
- **E 谜题/规则**：谜题本身或规则集
- **F 任务/叙事**：任务、事件、故事片段
- **G 美术/音频**：植被、生物外观、纹理

标记：✅ 来源确认；❌ 来源确认不生成或来源里未见（不等于证明没有）；`?` 未查到。

### Solutions Matrix

| 类型（代表作） | A 空间 | B 地形 | C 遭遇 | D 物品 | E 谜题 | F 任务 | G 美术 |
|---|---|---|---|---|---|---|---|
| Roguelike 地牢（Rogue、Diablo I–II、Angband） | ✅ | ❌ | ? | ? | ❌ | ? | ❌ |
| 平台跳跃 roguelite（Spelunky） | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 动作 metroidvania 混合（Dead Cells） | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Roguelike 卡牌（Slay the Spire） | ✅ | ❌ | ✅ | ? | ❌ | ❌ | ❌ |
| 网格谜题（Sokoban 类） | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 生存沙盒（Minecraft） | ✅ | ✅ | ✅ | ? | ❌ | ❌ | ❌ |
| 太空探索（No Man's Sky） | ❌ | ✅ | ✅ | ? | ❌ | ❌ | ✅ |
| 4X 策略（Civilization IV、FreeCiv） | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 赛车（程序化赛道） | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 合作射击（Left 4 Dead） | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| 开放世界 RPG（Skyrim、WoW） | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ⚠️ |

证据备注：
- **Roguelike 地牢**：综述称 Rogue、Diablo I–II、Angband、Dwarf Fortress 用于「室内空间与场景生成」；C、D 列该来源没有明说，标 `?`。综述还提到「场景（scenario）生成」，但没有说明是否包含任务或叙事，所以 F 列也标 `?`。
- **Spelunky**：综述称其生成「levels, items, monsters」。
- **Dead Cells**：开发者文章列出手工房间块、概念图、怪物分配和战利品生成步骤（战利品步骤文中含糊）。
- **Slay the Spire**：地图为 17 层、每层最多 6 个节点的图；房间类型按概率分配；奖励物品的生成规则没有读到，D 列 `?`。
- **Sokoban**：生成的是关卡即谜题本身，来自上一轮检索。
- **Minecraft**：wiki 列出的生成步骤包含结构、生物群系、噪声、地表、洞穴雕刻、地物、光照、刷怪。战利品未确认。
- **No Man's Sky**：星球、动植物、外星遭遇由确定性算法生成；美术是「人工素材经算法变形」。
- **Civilization IV / FreeCiv**：综述称程序化生成地形和资源。
- **赛车**：赛道几何由随机点 → 凸包 → 样条得到（一篇开发者文章）。
- **Left 4 Dead**：Director 控制刷怪、有限的物品选择和节奏，不生成关卡几何。物品只能从预置刷新点里选，故 D 列 ⚠️。
- **Skyrim / WoW**：综述称 Skyrim 用 Radiant Story 生成场景，WoW 主要是手工内容，植被用 SpeedTree 中间件；G 列 ⚠️ 因为综述把程序化植被归到 Oblivion 而不是 Skyrim，这一格按同系列保守给出。

### Discussion

生成内容分成三簇。第一簇是**空间即内容**：roguelike、Spelunky、Dead Cells、Slay the Spire、Sokoban、赛车，PCG 生成的是玩家要穿行或解开的结构。第二簇是**世界规模**：Minecraft、No Man's Sky、Civilization，生成的是连续地形与资源，靠数量取胜。第三簇是**调度**：Left 4 Dead 和 Skyrim 的 Radiant，几乎不碰空间，只决定「谁在什么时候出现」或「给什么任务」。

轴 1 里没有任何类型同时覆盖所有列，综述也指出商业游戏的使用常局限于某一类内容，设计层和衍生内容层基本仍是手工的。这意味着「PCG 什么都生成」不是常态，README 里明确说出你们生成了哪一层，比声称全生成更站得住。

## 4. Dimension 2: Architecture & guarantee

### Properties
- **A 结构性可完成**：不靠事后检查，生成结构本身保证有通路或有解
- **B 混入手工内容**：使用手工设计的房间块/资产/固定锚点
- **C 运行时自适应**：根据玩家状态或已发生事件调整后续生成
- **D 记录了缺陷/局限**：来源明确写出了质量或可玩性问题（❌ 表示读到的来源里没有，不是证明没有）

种子确定性原本也是一个候选属性，但读到的来源里只有 Slay the Spire、Minecraft、No Man's Sky 三处明确写了，其余都没提，没有一个类型被明确否定，不具备区分度，所以没有作为列。

### Solutions Matrix

| 类型（代表作） | A 可完成 | B 手工内容 | C 自适应 | D 记录局限 |
|---|---|---|---|---|
| Roguelike 地牢（BSP / 元胞自动机） | ⚠️ | ❌ | ❌ | ✅ |
| Spelunky | ✅ | ✅ | ❌ | ⚠️ |
| Dead Cells | ⚠️ | ✅ | ❌ | ✅ |
| Slay the Spire | ✅ | ⚠️ | ⚠️ | ? |
| Sokoban 类谜题 | ⚠️ | ❌ | ❌ | ✅ |
| Minecraft | ❌ | ? | ❌ | ✅ |
| No Man's Sky | ? | ✅ | ❌ | ✅ |
| Civilization 类 4X | ? | ❌ | ❌ | ⚠️ |
| 程序化赛道 | ⚠️ | ❌ | ❌ | ✅ |
| Left 4 Dead | — | ✅ | ✅ | ❌ |
| Skyrim Radiant | ? | ✅ | ✅ | ⚠️ |

证据备注：
- **Roguelike 地牢**：BSP 靠兄弟节点连接得到连通，元胞自动机常产生互不相连的洞穴，需要 flood fill 修复（上一轮检索）；所以 A 是 ⚠️，D 是 ✅。
- **Spelunky**：网格加模板的方法里，先生成一条穿越 4×4 网格的通路，房间模板规定了可达出口，模板内非关键格才随机（一篇 Spelunky 风格的教程，讲的是该方法而不是 Spelunky 源码，我没有取到 Derek Yu 本人的说明）。D 列 ⚠️：Wikipedia 写道 Yu 让地形可破坏，使关卡推进更宽容，玩家可以自己开路。
- **Dead Cells**：算法对每个节点随机选房间，不满足概念图要求就拒绝重选，所以 A 是 ⚠️（有约束检查，来源没有声称证明可完成）。D ✅：开发者写道纯程序化关卡「不合逻辑、混乱」，这是转向混合方案的理由。
- **Slay the Spire**：每个房间有 1–3 条入路和 1–3 条出路；第 1、9、15、16 层的房间类型固定；未知房间的类型概率随进入而调整；种子固定地图。B 和 C 都是 ⚠️（部分层固定；概率调整不是对玩家表现的自适应，但确实随游玩状态变化）。
- **Sokoban**：可解性是 PSPACE 完全，完整求解器在浏览器里太慢；反向生成会漏掉死锁，需要 BFS 补检（上一轮检索）。
- **Minecraft**：wiki 没有给出结构可达性或邻近保证。种子确定性有明确表述。B 列是否用手工结构模板，没有读到，`?`。
- **No Man's Sky**：确定性、64 位种子；素材是有限的预制资产，评论称之为「procedural oatmeal」；A 列没有相关资料。
- **Civilization 类**：一篇 2015 年论文的标题涉及「平衡的 Civilization 地图生成」，我只看到标题没读到内容，所以 D 只给 ⚠️，A 保持 `?`。
- **程序化赛道**：闭环由构造得到，但作者承认在所有难度参数下不保证不自交。
- **Left 4 Dead**：Director 不生成几何，只在设计师做好的路线里切换或封路；Tank、Witch 只出现在预设的威胁位置。A 列不适用，D 列在读到的来源里没有局限记录。
- **Skyrim Radiant**：基于模板，用玩家历史选取 NPC；来源提到它适合杂项任务，对主线内容的适用性只是间接暗示，所以 D 是 ⚠️。

### Discussion

**保证强度与手工比例正相关。** 有结构性保证的（Spelunky、Slay the Spire）都用固定锚点：Spelunky 的房间模板、Slay the Spire 里固定楼层。纯程序化的 Dead Cells 早期版本没有这些锚点，开发者报告结果混乱，于是改成混合方案。这个规律在样本里一致，但样本只有十来个，不宜外推。

**规模换保证。** 两个海量规模的样本（Minecraft、No Man's Sky）来源里都明确写了种子确定性，但都没有可完成保证：Minecraft 不保证结构可达，No Man's Sky 的主要批评是变化有限而不是不可玩。有结构性保证的样本（Spelunky、Slay the Spire）则限于单层关卡或单张地图的范围。

**自适应是稀缺列。** 只有 Left 4 Dead 和 Skyrim Radiant 明确根据玩家状态调整生成内容，Slay the Spire 只是部分。而 L4D 的 Director 完全不生成空间，因此自适应与空间生成在这个样本里没有同时出现。

## 5. Dimension 3: Prototype feasibility

### Properties
- **A rot.js 有原语**：手册目录里有可直接用的模块（Maze、Cellular、Dungeon、噪声、调度器、字符串生成器）
- **B 无需手工内容池**：不需要预先做房间块、卡牌、素材或文本池（✅ 表示不需要）
- **C 验证无需求解器/物理**：flood fill / BFS 一类的小检查就够（✅ 表示不需要求解器或物理模拟）
- **D 一分钟内可见**：玩家很快看到 PCG 的效果
- **E 范围风险低**：不需要物理、3D、AI 对手、大型内容系统

另有两个候选属性被删掉了：「验证便宜」和「README 一段话能讲清」，在这 11 行里都没有任何 ❌，没有区分度。

本表大部分格子是我基于上一轮和本轮检索的**判断**，没有做原型验证；`—` 表示该属性对该类型不适用。

### Solutions Matrix

| 类型（代表作） | A rot.js | B 无需内容池 | C 验证无需求解器/物理 | D 立即可见 | E 范围风险低 |
|---|---|---|---|---|---|
| Roguelike 地牢 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Spelunky 类平台跳跃 | ❌ | ❌ | ❌ | ✅ | ❌ |
| Dead Cells 类混合 | ❌ | ❌ | ⚠️ | ✅ | ❌ |
| Slay the Spire 类卡牌 | ❌ | ❌ | ✅ | ✅ | ⚠️ |
| Sokoban 类谜题 | ❌ | ✅ | ❌ | ✅ | ✅ |
| Minecraft 类沙盒 | ✅ | ⚠️ | — | ✅ | ⚠️ |
| 太空探索 | ✅ | ❌ | — | ✅ | ⚠️ |
| 4X 策略 | ✅ | ⚠️ | ⚠️ | ✅ | ❌ |
| 赛车 | ❌ | ✅ | ⚠️ | ✅ | ❌ |
| L4D 类 Director | ⚠️ | ❌ | — | ⚠️ | ⚠️ |
| Radiant 类任务 | ⚠️ | ❌ | — | ❌ | ✅ |

判断依据：
- **Roguelike 地牢**：rot.js 手册有 Maze、Cellular、Dungeon 三类生成，Red Blob Games 的项目展示了 Digger 取房间和走廊列表；验证是 BFS。
- **Spelunky 类**：跳跃可达性需要物理参数；一篇 2D 平台生成的文章承认仍有少数平台不可达，作者认为不值得做基于玩家物理的图分析。这是 C 和 E 列 ❌ 的原因。
- **Slay the Spire 类**：分层图的连通靠构造，C 列 ✅；范围风险在于战斗与卡牌池本身。
- **Sokoban 类**：完整可解性要求解器（PSPACE 完全），浏览器里要设状态数上限，所以 C 列 ❌；反向生成加 BFS 死锁检查是折中。
- **赛车**：几何算法简单，驾驶手感与物理是主要成本。
- **L4D 类**：rot.js 有调度器和引擎，可以做节奏循环，但要求先有设计好的地图；效果需要游玩一段时间才能看到。
- **Radiant 类**：rot.js 有字符串生成器，具体能力没读；任务生成要玩很久才看得出效果。

### Discussion

**只有 Roguelike 地牢在五列里全是 ✅**（且没有 `?`）。这也是 rot.js 这类工具存在的原因，它的手册和教程几乎围绕这一类型展开。Sokoban 类在 A、C 失分，其余三列都是 ✅，是第二梯队；Sokoban 类的代价是要自己写生成和死锁检查。

**规则简单和范围小不在同一行。** Slay the Spire 类的分层图规则简单，一张图就能说明，但需要战斗和卡牌系统；Roguelike 地牢范围最小，但「PCG 加了什么」需要你们自己再叠一层才够丰富。

## 6. Cross-cutting Discussion

三张表合起来，形成一个清晰的结构：

- **有结构性保证的样本范围有限，海量规模的样本没有保证。** 这是这批样本里最一致的模式，但样本只有 11 个，没有做过检验。
- **手工锚点是保证的来源。** Spelunky 的模板、Slay the Spire 的固定楼层、Dead Cells 的概念图和手工房间、L4D 的预置路线，都属于同一种设计：程序化只在设计师划定的范围内变化。
- **自适应与空间生成分家。** 调节「什么时候出什么」的机制（Director、Radiant）把空间留给设计师。

## 7. Recommendations

针对 §1 的上下文（一周、HTML+JS、README 要讲清）：

1. **主类型：Roguelike 地牢。** 三张表里它的可行性最高，验证只需要 BFS 或 flood fill，rot.js 直接提供地图生成。
2. **叠一层自适应，让 PCG 不止是地图。** 参考 Left 4 Dead 的做法：Director 只调刷怪，不碰空间，按 Build Up、Peak、Relax 循环并读取玩家受压程度。你们可以做一个极简版：根据玩家血量或近期受伤调整下一房间的敌人数量。这在样本里是最稀缺的属性（轴 2 C 列），也很好写进 README。这是我基于 L4D 资料做的设计建议，没有验证过效果。
3. **用手工锚点换保证。** 参考 Spelunky 和 Slay the Spire：起点、出口和 Boss 房间这类位置固定或限定，其余随机。这让「保证可完成」在 README 里有一句话的解释。
4. **备选：** 想要更强的叙事就选 Slay the Spire 类分层图，前提是接受战斗与卡牌的额外工作量；想要更强的「生成 + 验证」故事就选 Sokoban 类，前提是自己写生成与 BFS。

## 8. Open Problems

- 没有类型同时满足「规模大、有可完成保证、运行时自适应」。
- 综述指出关卡生成研究集中在 2D，3D 关卡生成需要更多研究。
- 基于 GAN 的关卡生成在训练时把关卡当图像，没有考虑验证约束。
- 便宜、可靠的难度信号仍缺失（上一份 SoK 已指出）。

## 9. Sources

- 内容层分类与类型示例（Hendrikx 等综述）: https://atlarge-research.com/pdfs/2013-hendrikx-procedural.pdf
- PCG 综述（含 2D 平台与 3D 研究缺口、GAN 局限）: https://arxiv.org/html/2410.15644v1
- Slay the Spire 地图生成: https://slaythespire.wiki.gg/wiki/Map_Generation
- Minecraft 世界生成: https://minecraft.wiki/w/World_generation
- No Man's Sky: https://en.wikipedia.org/wiki/No_Man%27s_Sky
- Dead Cells 混合关卡设计: https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/
- Left 4 Dead Director: https://left4dead.fandom.com/wiki/The_Director
- Radiant Story: https://en.wikipedia.org/wiki/Radiant_AI
- Spelunky（Wikipedia，仅设计理念，未含生成细节）: https://en.wikipedia.org/wiki/Spelunky
- Spelunky 风格的房间网格方法（教程，不是 Spelunky 源码）: https://www.lexaloffle.com/bbs/?tid=3653
- 2D 平台关卡生成与可达性局限: https://www.gamedev.net/articles/programming/general-and-gameplay-programming/procedural-level-generation-for-a-2d-platformer-r3794/
- 程序化赛道: https://www.gamedeveloper.com/programming/generating-procedural-racetracks
- 上一份 SoK（roguelike 算法与验证）及其来源: research/sok-pcg.md，来源包括 RogueBasin、rot.js 手册、Red Blob Games、Sokoban 相关论文与 DEV 文章

未能读到内容、因此没有作为证据使用的页面：Spelunky wiki（Level Generation/2，返回 402）、Derek Yu 的 Spelunky 生成说明（gameasart 文章只有介绍，没有算法内容）、UESP 的 Radiant 页面（返回 403）、Barros 2015 的 Civilization 平衡地图论文（重定向未取到正文，只用了标题）。

## 10. Limitations

- 每个类型只取一个或几个代表作，结论是这些代表作的模式，不代表整个类型。
- 轴 3 大多是判断，不是测量；轴 1、2 中的 ❌ 只表示读到的来源里没有，不是证明没有。
- 三张表共用同一批行，轴 3 依赖轴 1、2 的结果，正交性弱于第一份 SoK 那样的做法。
- 若干关键格子（Spelunky 的确切保证机制、Civilization 的地图平衡、Radiant 的局限）没有取到一手来源，已在正文标注。
- 快照时间：2026 年 9 月 29 日。
