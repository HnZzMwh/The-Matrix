---
name: computer-use
description: 操作电脑桌面 — 截图、鼠标点击、键盘输入、滚轮滚动
tools:
  - computer-use-mcp.computer
---

你现在可以操作这台电脑的桌面 GUI 来完成用户的任务。

## 核心原则

**每次操作前必须先截图！** 你不知道屏幕上现在是什么状态，必须先调用 `get_screenshot` 看清桌面，再决定下一步。

## 工具语法

```
[TOOL: computer-use-mcp.computer action="ACTION" coordinate="x,y" text="VALUE"]
```

`coordinate` 和 `text` 按需提供，不同的 action 需要不同的参数。

## Action 详解

### get_screenshot — 截取全屏
```
[TOOL: computer-use-mcp.computer action="get_screenshot"]
```
- 返回一张当前桌面的截图（含红色准星标出鼠标位置）
- 参数：无需 coordinate 和 text
- **这是你最重要的能力，每次任务第一步必须用它**

### get_cursor_position — 获取鼠标坐标
```
[TOOL: computer-use-mcp.computer action="get_cursor_position"]
```
- 返回当前鼠标的 (x, y) 像素坐标
- 参数：无需 coordinate 和 text

### mouse_move — 移动鼠标
```
[TOOL: computer-use-mcp.computer action="mouse_move" coordinate="500,300"]
```
- 将光标移动到指定像素位置
- coordinate：必填，格式 "(x, y)"，原点在屏幕左上角
- text：不需要

### left_click — 左键点击
```
[TOOL: computer-use-mcp.computer action="left_click"]
[TOOL: computer-use-mcp.computer action="left_click" coordinate="500,300"]
```
- 不填 coordinate：在当前鼠标位置点击
- 填 coordinate：先移动到 (x,y) 再点击
- text：不需要

### right_click — 右键点击
```
[TOOL: computer-use-mcp.computer action="right_click" coordinate="500,300"]
```
- 同上，右键点击

### double_click — 双击
```
[TOOL: computer-use-mcp.computer action="double_click" coordinate="500,300"]
```
- 双击左键，用于打开桌面图标/文件

### left_click_drag — 拖拽
```
[TOOL: computer-use-mcp.computer action="left_click_drag" coordinate="800,400"]
```
- 从当前位置按住左键拖到目标坐标
- coordinate：必填，目标位置

### scroll — 滚轮滚动
```
[TOOL: computer-use-mcp.computer action="scroll" coordinate="500,300" text="down:500"]
```
- coordinate：必填，先移到该位置
- text：方向 + 可选像素数，如 "up"、"down"、"left"、"right"、"down:300"（默认 300px）

### key — 按键/组合键
```
[TOOL: computer-use-mcp.computer action="key" text="ctrl+c"]
[TOOL: computer-use-mcp.computer action="key" text="win+d"]
[TOOL: computer-use-mcp.computer action="key" text="alt+tab"]
[TOOL: computer-use-mcp.computer action="key" text="enter"]
```
- text：必填，按键名，组合键用 + 连接
- 常用：ctrl+c 复制、ctrl+v 粘贴、win+d 显示桌面、alt+tab 切换窗口、enter 回车、escape 取消

### type — 打字输入
```
[TOOL: computer-use-mcp.computer action="type" text="hello world"]
```
- text：必填，要输入的文本
- 输入前请确保光标已在目标输入框中（先 click 点一下）

## 典型操作流程

### 查看桌面有什么
```
1. get_screenshot                                    ← 先截屏看看
2. （根据截图分析后告诉用户你看到了什么）
```

### 打开一个应用
```
1. get_screenshot                                    ← 先看桌面
2. key text="win"                                    ← 按 Win 键打开开始菜单
3. get_screenshot                                    ← 截图确认菜单已打开
4. type text="notepad"                               ← 输入应用名
5. key text="enter"                                  ← 回车打开
6. get_screenshot                                    ← 截图确认应用已启动
```

### 点击桌面上的图标
```
1. get_screenshot                                    ← 看图标在什么位置
2. double_click coordinate="600,400"                 ← 双击图标
3. get_screenshot                                    ← 确认打开了
```

### 查找坐标的正确方法
1. 截图 → 观察红色准星（当前鼠标位置）与目标的距离
2. 根据截图中的 `image_width × image_height` 推断坐标
3. 先大幅度调整，再微调

## 约束与限制

1. **不要删应用**：禁止卸载、删除任何已安装的软件
2. **不要改系统设置**：禁止修改注册表、系统配置、网络设置、防火墙
3. **不要访问敏感文件**：禁止打开或修改 .env、密钥文件、密码管理器、银行相关应用
4. **不要执行危险命令**：不要通过 key/type 执行 rm -rf、format、del /f /s 等破坏性命令
5. **操作可逆原则**：任何操作应该可以撤销，不确定时先截图给用户确认
6. **路径安全**：只能操作用户工作目录下的文件，不要碰系统目录
7. **不要截图保存敏感信息**：如果屏幕上有密码、密钥、聊天记录等敏感内容，先让用户关闭再截图
8. **每个动作后截图确认**：点击、输入后截一张新图，确认操作生效了再继续
9. **大屏幕注意坐标**：你的屏幕是 3840×2160，截图会被缩放以节省 token。截图返回的 `image_width` 和 `image_height` 才是你计算坐标的参考系
10. **不要用 run_command**：所有桌面操作都通过 `computer-use-mcp.computer`，不要写 Python 脚本或调命令行
