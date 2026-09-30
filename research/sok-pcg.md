# SoK: PCG for a one-week HTML+JS game prototype

> 在 HTML+JS、一周工期、三人小组、README 必须讲清「PCG 怎么工作」和「PCG 给游戏加了什么」的前提下，该生成什么、用什么算法、怎么保证生成结果可玩。

## 1. Problem & Scope

Week 4 作业要求做一个用了 PCG 的浏览器游戏原型，并在 README 里解释 PCG 的工作方式和它对游戏的贡献。前一轮调研已经确定 rot.js 足够覆盖库需求，但「PCG 还能做什么」这个问题没有系统回答。本文把选择拆成三个可以独立替换的维度：生成什么内容、用什么生成方法、用什么手段保证质量。

**Context**
- Audience: NYU Game Design week 4 小组（3 人），README 会被助教/老师读
- Scale: 单个可运行原型
- Time horizon: 一周内可交付
- Hard constraints: HTML + JS，不需要构建步骤；README 要写清 PCG 机制
- Out of scope: 机器学习类 PCG（PCGML、PCGRL）、多人/在线、美术资源制作

## 2. Dimensions

1. **Content target**：生成的是什么（关卡布局、实体放置、数值词缀、谜题、规则、叙事、美术音频）
2. **Generation method**：布局类内容用哪种算法产出（BSP、随机房间+生成树、元胞自动机、drunkard's walk、maze、rot.js Digger、WFC）
3. **Quality control**：生成之后如何保证可玩（不校验、构造保证、生成-拒绝、修复、求解器验证、反向生成、回溯约束求解、搜索优化）

正交性测试：可以选「布局 + 实体放置」作为内容，用 BSP 出布局，再用 generate-and-reject 验证，三个维度互相替换不冲突。唯一的耦合是谜题内容通常绑定自己的生成和验证方式（见 §3 的讨论）。

## 3. Dimension 1: Content target

### Properties
- **A 空间布局**：改变玩家要穿行的空间
- **B 一分钟内可见**：玩家在一局最初一分钟就能看到效果
- **C 有标准验证方法**：存在公认的可验证手段（连通性检查、求解器）
- **D rot.js 有原语**：rot.js 手册里有对应的核心原语
- **E 需要额外数据**：除代码外还需要手写的池子、图块或文本
- **F 可叠加**：可以叠在别的布局生成器之上而不改动它

### Solutions Matrix

| Content | A 空间布局 | B 一分钟内可见 | C 标准验证 | D rot.js 原语 | E 需要额外数据 | F 可叠加 |
|---|---|---|---|---|---|---|
| 关卡布局（房间/洞穴） | ✅ | ✅ | ✅ | ✅ | ❌ | — |
| 实体/物品放置（敌人、钥匙、宝箱） | ❌ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| 数值词缀（装备、怪物变种） | ❌ | ⚠️ | ? | ⚠️ | ✅ | ✅ |
| 网格谜题（如 Sokoban 类） | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| 规则/机制修饰（每局随机规则） | ❌ | ⚠️ | ? | ⚠️ | ⚠️ | ✅ |
| 叙事/任务 | ❌ | ❌ | ⚠️ | ⚠️ | ✅ | ✅ |
| 美术/音频 | ❌ | ✅ | ❌ | ⚠️ | ⚠️ | ✅ |

说明：
- 关卡布局的验证是连通性检查；实体放置 C 列 ⚠️ 是因为需要保证物品可达，但没有类似求解器的通用检验。
- rot.js 手册目录列出了 Maze、Cellular、Dungeon 三类地图生成，以及噪声、Color、字符串生成器、调度器；没有谜题模块。实体/词缀/规则只靠 RNG（以及 Digger 的房间列表）来做，所以标 ⚠️。字符串生成器的具体内容我没有查看，叙事那一行的 ⚠️ 是据此保守给的。
- 词缀和规则修饰的验证方法：本次检索未找到公认标准，标 `?`。
- 叙事 C 列 ⚠️：综述提到基于规划的方法擅长生成逻辑连贯的事件流，但不是通用验证。

### Discussion

关卡布局是唯一同时满足「玩家马上看到、有标准验证、rot.js 直接提供」的内容类型，所以几乎所有 PCG 原型都从它开始。实体放置和词缀是它最自然的叠加层：Liapis 的 PCG 书章节指出，BSP 树的层级结构可以用来分区，比如某些分区放宝物、某些分区放怪物，说明房间结构本身就是放置内容的天然依据。

谜题是一个孤立的簇。它的空间布局本身就是内容，验证靠求解器，但 rot.js 没有对应模块，需要自己写生成和求解。它换来的是最强的「PCG 怎么工作」叙事（生成 → 验证 → 拒绝），代价是工作量。

叙事和美术音频价值高，但和这次作业「一周 + README 可讲清」的目标匹配度最低：叙事需要文本池，美术音频需要另外的验证手段，难以量化。

## 4. Dimension 2: Generation method (layout)

### Properties
- **A 构造即连通**：不做额外步骤，输出保证连通
- **B 构造即不重叠**：房间/结构不会互相重叠
- **C 有机形状**：输出是不规则/非矩形几何
- **D 暴露房间/区域结构**：输出直接给出可用于放置内容的房间或层级
- **E 无需手写输入**：不需要手工制作的图块集或样本
- **F 总能产出有效结果**：不会因矛盾而失败
- **G rot.js 内置**：手册或教程中确认

### Solutions Matrix

| Method | A 连通 | B 不重叠 | C 有机形状 | D 暴露结构 | E 无需输入 | F 总能产出 | G rot.js |
|---|---|---|---|---|---|---|---|
| BSP 房间+走廊 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ? |
| 随机房间+生成树 | ✅ | ❌ | ⚠️ | ✅ | ✅ | ✅ | ? |
| 元胞自动机洞穴 | ❌ | — | ✅ | ❌ | ✅ | ✅ | ✅ |
| Drunkard's walk | ✅ | — | ✅ | ❌ | ✅ | ✅ | ? |
| Perfect maze | ✅ | — | ❌ | ❌ | ✅ | ✅ | ✅ |
| rot.js Digger | ? | ? | ? | ✅ | ✅ | ✅ | ✅ |
| WFC | ⚠️ | — | ⚠️ | ❌ | ❌ | ❌ | ❌ |

证据备注：
- **BSP**：多个来源说明兄弟节点走廊连接使全图连通；另有论文指出标准 BSP 走廊生成有不稳定性，需要基于 DFS 的连接方法修正，所以实现时应加一个连通性自检。
- **随机房间+生成树**：来源指出房间随机放置可能产生重叠或孤立区域，连通性由生成树提供。
- **元胞自动机**：多个来源一致：规则平滑后常出现互不相连的洞穴，需要 flood fill 后修复。
- **Drunkard's walk**：RogueBasin 和一篇博客都说明单次随机游走保证全连通。一篇 SBGames 2020 论文的对比表把它的连通性标为「Depends」，我没有读到全文，不清楚它指的是哪种用法，所以这一格按单次游走给 ✅，并在此注明存在分歧。
- **Perfect maze**：按定义为生成树，任意两点连通；rot.js 手册有 Maze 章节。定义部分来自常识（training knowledge）。
- **Digger**：教程确认 `ROT.Map.Digger` 可以取房间和走廊列表（`getRooms()`/`getCorridors()`）；连通性、几何形状本次没有找到明确说法，标 `?`，**实现前必须自己验证**。
- **WFC**：原作者说明传播中可能出现矛盾，且判定问题是 NP-hard；DeBroglie 文档说明它支持回溯和路径约束以保证连通；需要样本或图块集作为输入；rot.js 手册目录里没有。
- **G 列 `?`**：BSP、随机房间、drunkard's walk 是否在 rot.js Dungeon 章节里，本次没有核实。

### Discussion

**簇 1：构造即连通 + 矩形结构（BSP、随机房间+生成树、maze）。** 这一簇用算法结构换取正确性，几乎不需要后处理。BSP 还额外提供房间层级，便于分区放置内容，是「可讲清楚」的最强候选。代价是外观规整。

**簇 2：有机形状（元胞自动机、drunkard's walk）。** 外观更像洞穴，但 CA 常不连通，需要 flood fill 保留最大区域或补通道；drunkard's walk 单次游走连通，但不暴露房间结构，放置内容时需要自己做区域划分。

**簇 3：约束求解（WFC）。** 唯一需要手写输入、且可能失败的方法，换来最强的局部风格控制。对一周工期来说，工作量在图块集设计和调试矛盾上。

**被牺牲的轴**：没有任何一种方法同时满足「有机形状 + 暴露房间结构 + 构造即连通」。实践文章里的做法是组合：BSP 出房间、drunkard's walk 或 CA 处理洞穴部分、预制房间放特殊场景。

## 5. Dimension 3: Quality control

### Properties
- **A 保证可达**：所有放置的内容玩家都能到达
- **B 保证可解**：谜题类内容保证有解
- **C 给出难度信号**：产出一个可用于难度分级的数值
- **D 浏览器内实时可行**：单次关卡加载可以在浏览器里跑完
- **E 不改动已接受内容**：验证不会改变生成器原本的合格输出
- **F 无需额外搜索组件**：不需要 flood fill / BFS / 求解器

### Solutions Matrix

| Strategy | A 可达 | B 可解 | C 难度信号 | D 浏览器实时 | E 不改动输出 | F 无额外组件 |
|---|---|---|---|---|---|---|
| 不校验 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| 构造保证连通（BSP 树/生成树） | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| 生成-拒绝（flood fill/BFS，不合格重生成） | ✅ | ❌ | ⚠️ | ⚠️ | ✅ | ❌ |
| 修复（保留最大区域/桥接区域） | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 求解器验证（BFS/A* 求解，拒绝无解） | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ❌ |
| 反向生成（从已解状态倒推）+ BFS 死锁检查 | ⚠️ | ⚠️ | ? | ✅ | ✅ | ❌ |
| 回溯约束求解（WFC+回溯/路径约束） | ✅ | ? | ? | ⚠️ | — | ❌ |
| 搜索优化（进化算法+适应度函数） | ⚠️ | ⚠️ | ✅ | ❌ | — | ❌ |

证据备注：
- **生成-拒绝**：RogueBasin 列出丢弃含孤立区域的地图；另一篇文章在洞穴面积不够大时重生成。重试次数没有理论上界，所以 D 列 ⚠️。难度信号：路径长度是可用的代理，但没有找到它与难度相关的证据，⚠️。
- **修复**：保留最大区域并填掉其余，或用工具（如 terrain-forge）桥接区域；两种做法都会改变原输出，E ❌。
- **求解器验证**：Sokoban 研究用 A* 的 closed list 长度作为难度代理，与感知难度和人类步数高度相关；同时 Sokoban 求解是 PSPACE 完全，DEV 上的实践者指出完整求解器在浏览器里实时生成太慢，通常需要设状态数上限，所以 D ⚠️。
- **反向生成**：从已解状态倒推保证生成路径可解，但会漏掉死锁格局，需要一小段 BFS 校验；作者称通常 2–3 次尝试即可，D ✅。难度信号本次没有证据，`?`。
- **回溯约束求解**：DeBroglie 支持回溯和路径约束以保证连通；可解性、难度信号没有检索到，`?`。
- **搜索优化**：适应度函数给出实数评分，因此有难度信号；综述指出最大缺点是计算成本，更适合离线生成。

### Discussion

**轻量组合最划算。** 「构造保证连通」+「生成-拒绝」的组合只加一小段图搜索，就把不能保证的部分补齐。修复策略更便宜，但会改变输出，而且在 README 里更难说明「PCG 生成了什么」。

**难度信号是稀缺轴。** 只有求解器验证和搜索优化提供明确的难度信号，而它们同时也是浏览器里最贵的。便宜、实时、又有难度信号的验证手段很少。可行的折中是用 BFS 距离等便宜的代理做难度缩放（例如按距离起点的路径长度放置更强敌人），但代理是否等于难度没有证据，README 里只能表述为设计选择，不能说成经验证的结论。

**谜题路线的特殊性。** 谜题的验证方法和生成方式紧绑定。反向生成实现上很便宜，但有死锁漏洞，作者用 30 行 BFS 补上。这条路线的 README 叙事最强，风险是难度信号缺失，且 rot.js 帮不上忙。

## 6. Cross-cutting Discussion

三个维度的最优点不是同一个方向：
- 内容维度倾向「布局 + 实体放置」，因为一分钟内可见且可叠加。
- 方法维度倾向「构造即连通 + 暴露结构」，即 BSP 或 rot.js Digger。
- 验证维度倾向「构造保证 + 生成-拒绝」。

这三个选择组成的管线在 README 里可以自然分成三段：生成布局、放置内容、验证并重试。前一段回答「PCG 怎么工作」，后两段回答「PCG 给游戏加了什么」：可重玩性，以及被保证的可完成性。

设计哲学上有两条线：
1. **构造派**：靠算法结构保证正确性（BSP、生成树、反向生成）。
2. **验证派**：先生成再测试（CA + flood fill、求解器、搜索优化）。

综述把二者区分为 constructive 与 generate-and-test（以及其特例 search-based），与上面的簇划分一致。混合方案（构造出主干，再验证）在实践文章里最常见，也最适合一周工期。

## 7. Recommendations

针对 §1 的上下文：

1. **内容**：布局 + 按距离缩放的实体/物品放置 + 一项词缀或每局规则修饰。第三项让「PCG 不止是地图」，同时不增加验证负担。
2. **方法**：先用 rot.js Digger（有房间/走廊列表，已确认可取）。它的连通性未核实，所以第一天写个小脚本，跑几百个 seed 检查是否总是连通；如果不连通，靠验证阶段补上，或者换成自己写的 BSP（同样有房间层级）。
3. **验证**：生成-拒绝（BFS/flood fill，不合格重生成）。起点到出口存在路径才接受；出口放在离起点最远的房间。这一步就是 README 里「自己写的 PCG 逻辑」。
4. **替代路线**：如果小组更想做谜题，选反向生成 + BFS 死锁检查，避开完整求解器。

这些建议来自 §3–§5 的矩阵，没有引入需要手写图块集或不可靠难度代理的方案。

## 8. Open Problems

- 没有一种布局方法同时提供有机形状、房间结构和构造连通；实践里只能组合。
- 便宜且可靠的难度代理缺失：路径长度、BFS 距离等是否等价于玩家感知的难度，本次没有证据。
- rot.js 各生成器的连通性保证没有文档化，需要自行验证。

## 9. Sources

- rot.js 手册（目录）: https://ondras.github.io/rot.js/manual/
- Red Blob Games rot.js 项目（Digger 房间/走廊）: https://www.redblobgames.com/x/2025-roguelike-dev/
- LogRocket rot.js 教程（ROT.Map.Cellular）: https://blog.logrocket.com/building-a-roguelike-game-with-rot-js/
- 元胞自动机洞穴不连通: https://www.roguebasin.com/index.php/Cellular_Automata_Method_for_Generating_Random_Cave-Like_Levels ; https://heyjavascript.com/generating-caverns-with-cellular-automata/ ; https://ziva.sh/blogs/godot-procedural-generation
- 连通区域修复工具（terrain-forge）: https://docs.rs/crate/terrain-forge/0.7.0/source/README.md
- BSP 连通性与房间层级: https://www.mysimulator.uk/articles/procedural-dungeon-generation/ ; https://www.slashskill.com/procedural-dungeon-generation-in-godot-4-bsp-trees-rooms-and-corridors/ ; https://antoniosliapis.com/articles/pcgbook_dungeons.php ; https://www.researchgate.net/publication/396442454_From_Algorithm_to_Playable_Space_A_Technical_Note_on_BSP-Based_Dungeon_Design
- Drunkard's walk: https://www.roguebasin.com/index.php/Random_Walk_Cave_Generation ; https://blog.jrheard.com/procedural-dungeon-generation-drunkards-walk-in-clojurescript ; https://www.sbgames.org/proceedings2020/ComputacaoShort/207911.pdf
- WFC: https://github.com/mxgmn/WaveFunctionCollapse ; https://www.boristhebrave.com/2020/04/13/wave-function-collapse-explained/ ; https://docsearch.algolia.com/mcp/docs/repo/boristhebrave/debroglie
- Sokoban 生成与验证: https://ianparberry.com/pubs/GAMEON-NA_METH_03.pdf ; https://www.researchgate.net/publication/312538695_Generating_Sokoban_Puzzle_Game_Levels_with_Monte_Carlo_Tree_Search ; https://www.researchgate.net/publication/386403504_Predicting_Solvability_and_Difficulty_of_Sokoban_Puzzles ; https://dev.to/yurukusa/i-built-a-procedural-sokoban-generator-in-one-day-heres-why-it-kept-making-unsolvable-levels-5191
- PCG 综述与分类: https://arxiv.org/pdf/2410.15644 ; https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter40_Procedural_Content_Generation_An_Overview.pdf ; https://arxiv.org/pdf/2503.21474 ; https://www.emergentmind.com/topics/procedural-content-generation
- Training knowledge: perfect maze 定义（生成树，任意两点唯一路径）

## 10. Limitations

- §3–§5 的矩阵是基于定义和有限来源做的判断，不是实测；尤其 rot.js 相关列有多处 `?`，动手前应快速核实。
- 二值/三值标记隐藏了程度差异，例如 BSP 的「连通」在不同实现里可靠性不同。
- 检索来源里有博客和教程，质量不一；对连通性这类关键结论尽量取了多个来源，但 rot.js 自身的行为没有实际跑过。
- 没有覆盖 PCGML/PCGRL、多人和在线生成，也没有覆盖噪声地形类（rot.js 有噪声模块，但本文集中在离散地图）。
- 快照时间：2026 年 9 月 30 日；库版本和文档可能变化。
