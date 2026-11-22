# Kitten4 协作聊天

![version](https://img.shields.io/badge/version-3.5-ff7829)
![manifest](https://img.shields.io/badge/manifest-v3-4285f4)
![chrome](https://img.shields.io/badge/Chrome%20%2F%20Edge-111%2B-34a853)
![tests](https://img.shields.io/badge/tests-72%20%2B%2066%20passed-27b56a)

该项目仅在github发布，其他平台皆为盗版，盗版可以会被植入恶意代码，如果被盗号、毁号，该项目部承担任何责任，请在github下载并使用

## 这是什么

编程猫 Kitten4 的多人协作只能改积木，没法说话。这个扩展在协作频道里开一条**旁路**：把聊天消息伪装成一条原生注释发出去，对方的插件在它变成积木评论之前截下来，所以编辑区上永远看不到东西。


> **免责声明**：仅供学习和交流使用，与编程猫官方无关。请勿用于刷屏、骚扰或其他影响他人正常协作的行为；因使用本扩展产生的一切后果由使用者自行承担。


## 文件结构

```
manifest.json           扩展清单（MV3，world: MAIN，只匹配编辑器首页）
inject.js               注入脚本：接管 WebSocket、按真实协议收发注释、解析身份
content.js              聊天 UI（隔离世界）：界面、状态、回执、开合动画、未读
style.css               液态玻璃样式（cmc- 前缀，避免和编辑器冲突）
icon.svg                图标源文件（透明底）
icon16/32/48/128.png    扩展图标（根目录，清单直接引用）
```

## 许可

代码仅供个人学习与交流使用，未附带正式开源许可；转发、二次开发请保留出处，并自行评估合规风险。
