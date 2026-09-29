# 野生菌采集鉴定图谱（gbfungiguide）

面向蘑菇野外调查爱好者与地方菌物名录整理者，把「采集点 → 形态描述 → 孢子印 → 菌褶/菌管着生方式 → 鉴定结论」整理成可对照的图谱条目，解决形态特征记不全、描述口径不一、鉴定结论缺乏依据留痕的问题。**纯前端单页应用**，数据全部保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

> 免责声明：本工具仅用于采集记录与形态整理，**内容不可作为食用依据**；鉴定须与权威图鉴和专业人员复核。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21816>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbfungiguide
FRONTEND_PORT=21816
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（`vue-tsc` 类型检查零错误） |
| UI 组件库 | Element Plus |
| 状态管理 | Zustand（`zustand/vanilla` createStore + Vue 响应式桥接） |
| 路由 | Vue Router 4（History 模式，nginx `try_files` 回落） |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） || 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21816
npm run build      # 类型检查 + 生产构建
```

## 四、目录结构

```
sologsb-1116/
├── docker-compose.yml          # 顶层 name: gbfungiguide，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # record.ts / spore.ts / point.ts / identify.ts / curation.ts / index.ts
│       ├── stores/             # recordStore / sporeStore / pointStore / identifyStore / curationStore（Zustand）
│       ├── components/common/  # SporePrintSwatch / TraitsSummary / GillAttachmentTag / GeoPointForm / CurationTrace / AttachmentAssignTable / RecordDraftForm
│       ├── components/curation/ # MergePanel / SplitPanel（整理向导）
│       ├── hooks/              # usePersistentStore / useCandidateMatch
│       ├── pages/              # AtlasPage / RecordDetailPage / PointsPage / IdentifyPage / ComparePage / CurationPage
│       ├── router/index.ts
│       └── utils/              # spore.ts / export.ts / id.ts / curation.ts / guards.ts（整理安全校验）
│   └── scripts/test-guards.mjs # 整理安全校验独立测试：node scripts/test-guards.mjs
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| FungusRecord 菌物条目 | 采集编号、暂定名、菌盖（直径/形状/边缘/质地）、菌肉厚度与变色反应、着生方式、菌褶密度、菌柄、菌环菌托、气味、关联树种；含整理状态 `status`（active/merged/split）、`mergedIntoId`、`splitFromId` | `records` |
| SporePrint 孢子印 | 印色、印形、获取时长、观察日期、样本干湿度 | `spores` |
| CollectPoint 采集点 | 地点名、经纬度、海拔、植被类型、基物、伴生树种、日期、采集人 | `points` |
| IdentifyLog 鉴定结论 | 结论学名、依据、参考图鉴与页码、置信度、是否待复核、复核人 | `identifies` |
| CurationEvent 整理事件 | 合并/拆分留痕：参与条目、逐项字段采用情况、孢子印与鉴定留痕去向，以及操作前的条目/孢子印/鉴定快照 | `curations` |

- 数据库名 `gbfungiguide`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史条目补齐「菌肉变色反应」默认值（不变色）；
- `version(3)` 新增记录整理：`curations` 表与条目状态/来源指针索引，并为历史条目补 `status='active'`；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

### 记录整理规则（合并 / 拆分）

- **合并重复条目**：选择 2 条以上正常条目并指定一条主条目；20 个形态字段逐项选择采用值（冲突行高亮），孢子印与鉴定留痕逐项指定「转到主条目」或「留在原来源」。来源条目转为 `merged` 归档快照，原始形态、未采用观察与其留痕一律不改。
- **拆分混采编号**：生成至少 2 条独立条目，每条必须有新的采集编号（不得沿用原编号、不得与现有编号重复），逐字段核对并指定孢子印/鉴定留痕转入哪条产物；未转出的随原条目保留，原条目转为 `split` 来源快照。
- **停止条件（`utils/guards.ts`）**：预演后若出现活跃编号重复、孢子印/鉴定/采集点关联缺失、合并指针自指或成环（含来源互相指向）、整理事件与条目状态不一致，则抛 `CurationGuardError`；全部写入落在单个 Dexie 事务内，整体回滚——原记录、孢子印和鉴定留痕都不改。
- **展示口径**：图谱默认只显示活跃条目（可勾选查看归档快照），对比与鉴定候选排序仅统计活跃条目；详情页顶部对归档快照给出来源/去向提示，孢子印与鉴定留痕标注「整理转入 / 随快照保留」；整理历史时间线随 IndexedDB 持久化，重开浏览器仍可逐级追溯。
- 整理链路上的条目（归档快照、合并主条目、拆分产物）禁止直接删除，防止追溯链断裂。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/atlas` | 图谱总览：网格卡片展示菌盖形态要点、孢子印色块与鉴定状态，按印色/着生方式筛选并新建条目 |
| `/atlas/:id` | 条目详情：形态描述分区折叠、孢子印观察登记、采集点编辑（含坐标校验）、鉴定留痕 |
| `/points` | 采集点管理：经纬度格式校验、条目数与主要基物统计、删除前校验下级条目 |
| `/identify` | 鉴定工作页：左侧勾选形态特征与印色，右侧实时给出候选名录排序，确认后落鉴定结论 |
| `/curation` | 记录整理：合并重复条目（逐项选冲突形态值、指定孢子印/鉴定去向）与拆分混采编号（多条新编号独立条目），含整理历史追溯 |
| `/compare` | 条目对比：并排最多 3 条（仅正常条目），逐项对照菌盖/菌褶菌管/孢子印差异并高亮 |

## 七、候选排序规则

- 权重：着生方式 26、孢子印 22、菌盖形状 12、表面质地 10、菌褶密度 10、菌盖边缘 8、菌肉反应 8、关联树种 4；
- 印色与条目着生方式若属于该印色的先验组合（如白色↔离生/弯生），计半分；
- 排序先比总分，总分相同则优先展示着生方式一致的条目。
