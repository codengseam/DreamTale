---
title: 第72章：网络管理SDN与5G
book: 系统架构师备考
chapter: 架构师72
event: 网络管理SDN与5G
sort: 1
chapter_sort: 72
created_at: 2026-07-01
source_agents:
- exam-expert
---

## 概念

### 这章考什么

- **科目**：中级网络工程师综合知识、高级系统架构设计师综合知识
- **考频**：中级新增考点，高级 2026 高频
- **分值**：中级约 6-10 分，高级约 4-8 分
- **难度**：中等，概念多但计算少，重在理解架构思想

网络管理是基础运维工具，SDN/NFV/5G 是新一代基础设施。这章是从传统网络工程师迈向架构师和云原生网络的关键跳板。

## 原理

### 【中级重点】网络管理

#### SNMP

Manager/Agent 架构：Manager 网管工作站发请求，Agent 设备侧代理响应，MIB 管理信息库存被管对象，OID 对象标识符树状定位。

操作：

- **Get**：Manager 取单个变量
- **GetNext**：取下一个，遍历用
- **GetBulk**（v2c 新增）：批量取，减少往返
- **Set**：设置变量
- **Trap**：Agent 主动告警，UDP 162
- **Inform**（v2c 新增）：带确认的 Trap

MIB 树根是 ISO(1).org(3).dod(6).internet(1)，常见前缀 1.3.6.1.2.1（系统接口）、1.3.6.1.4.1（厂商私有）。

| 版本 | 认证 | 加密 | 批量 | 安全性 |
|---|---|---|---|---|
| v1 | Community 明文 | 无 | 无 | 低 |
| v2c | Community 明文 | 无 | GetBulk | 低 |
| v3 | USM 用户名+HMAC | AES/DES | GetBulk | 高 |

v3 引入 USM 用户安全模型和 VACM 视图访问控制，是企业级网络管理的首选。

#### NetFlow 与 sFlow

NetFlow 思科私有，基于流（五元组+TOS+入接口）统计字节数包数，精细化但消耗设备资源。sFlow 采样流量，1:N 抽样，硬件级低开销，适合高速链路。

### 【中级重点】网络故障排查工具

| 工具 | 协议 | 用途 |
|---|---|---|
| ping | ICMP Echo | 测连通性、RTT |
| traceroute | TTL 递增 | 测路径，Linux UDP/Windows ICMP |
| netstat | TCP/UDP | 连接、路由表、接口统计 |
| tcpdump | 抓包 | 命令行抓包分析 |
| wireshark | 抓包 | 图形化深度分析 |
| arp | ARP | 查看 ARP 缓存 |
| route | 路由 | 查看/操作路由表 |
| nslookup/dig | DNS | 解析域名 |
| ipconfig/ifconfig | 系统 | 查看 IP 配置 |

traceroute 原理：发 TTL=1 的包，第一跳回 ICMP 超时；TTL=2，第二跳回超时；依次递增直到到达目的或超阈值。

### 【中级重点】SDN 软件定义网络

核心思想：控制平面与数据平面分离。传统网络每台设备既跑控制又跑转发，SDN 把控制集中到控制器，设备只管转发。

三层架构：

| 层 | 组件 | 功能 |
|---|---|---|
| 应用层 | 网络应用 | 网络服务、策略 |
| 控制层 | 控制器 | 集中控制、决策 |
| 数据层 | 转发设备 | 按流表转发 |

接口：

- **南向接口**：控制器与转发设备间，OpenFlow 是事实标准，流表由 Match（匹配字段）+ Instructions（动作）+ Counters（计数）组成
- **北向接口**：控制器与应用间，REST API 为主流

控制器：ODL OpenDaylight（模块化、Java）、ONOS（运营商级、高可用）、Floodlight（轻量、学术）。

优势：集中控制全局视图、可编程快速创新、流量调度灵活、新业务上线快。

### 【中级重点】NFV 网络功能虚拟化

ETSI 架构三部分：

- **VNF 虚拟网络功能**：用软件实现路由器、防火墙、负载均衡
- **MANO 管理与编排**：VNF 生命周期管理
- **NFVI 基础设施**：计算/存储/网络虚拟化资源池

NFV vs SDN：NFV 关注网络功能软件化（替代专用硬件），SDN 关注控制与转发分离。两者正交，可组合。

### 【中级重点】IPv6 部署

过渡技术：

- **双栈**：设备同时跑 v4 v6，最简单，需双栈地址
- **隧道**：6to4（自动）、6in4（手工）、ISATAP、Teredo
- **NAT64+DNS64**：v6 主机访问 v4 资源，DNS64 合成 AAAA 记录

IPv6 地址分配：SLAAC 无状态地址自动配置（路由器 RA 广播前缀，主机用 EUI-64 生成接口 ID）、有状态 DHCPv6、SLAAC+无状态 DHCPv6（地址 SLAAC、其他信息 DHCPv6）。

### 【中级重点】5G 移动通信

三大场景：

| 场景 | 全称 | 特点 | 典型应用 |
|---|---|---|---|
| eMBB | 增强移动宽带 Enhanced Mobile Broadband | 大带宽 | 4K/VR/AR |
| uRLLC | 超可靠低时延 Ultra-Reliable Low-Latency Communications | 1ms 时延、99.999% 可靠 | 工业控制、自动驾驶 |
| mMTC | 大连接物联网 Massive Machine Type Communications | 百万连接/km² | 智慧城市、传感器 |

网络切片：基于 NFV/SDN，一张物理网络切片成多个逻辑网络，每切片满足不同场景需求。

SBA 服务化架构：基于 HTTP/2 的服务接口，模块化、可组合。

核心网网元分离：

- **AMF** 接入和移动性管理：替代 4G MME 部分
- **SMF** 会话管理：建立和管理会话
- **UPF** 用户面功能：数据转发，可下沉到边缘

边缘计算 MEC：UPF 下沉到边缘，时延敏感场景（工业 AR、车联网）本地处理，不出核心网。

### 【中级重点】物联网网络层

| 技术 | 距离 | 速率 | 功耗 | 场景 |
|---|---|---|---|---|
| NB-IoT | 远（10km+） | 低 | 极低 | 智能水表 |
| LoRa | 远（10km+） | 低 | 极低 | 农业监测 |
| Sigfox | 远 | 极低 | 极低 | 简单传感 |
| Zigbee | 近（100m） | 中 | 低 | 智能家居 |
| Bluetooth | 近（10m） | 中 | 低 | 可穿戴 |

NB-IoT 蜂窝授权频谱、运营商级、深度覆盖好；LoRa 工作在 Sub-GHz 免授权频谱、可自建网络、抗干扰弱于 NB-IoT。

## 实践

### 【高级衔接】云原生网络架构

Service Mesh 服务网格：用 sidecar 代理接管微服务间通信，应用代码无感知。Istio/Linkerd 在每 Pod 注入 Envoy，把流量管理、熔断、可观测性从应用下沉到基础设施。架构师视角看，Service Mesh 把网络策略从代码搬到配置，运维和应用解耦。

网络策略 Network Policy：Kubernetes 原生，基于标签限定 Pod 间通信。零信任架构的容器级落地。

5G+边缘计算选型：实时性强的工业互联网用 uRLLC + MEC 本地卸载；海量连接的智慧园区用 mMTC；消费级高清用 eMBB。架构师需评估切片成本、MEC 部署位置、回传带宽，避免为场景过度配置。

**真题示例（2024年·综合知识·SDN架构相关·考生回忆）**：SDN 控制器与交换机之间的接口称什么？答：南向接口，代表协议 OpenFlow。控制器与应用之间的接口称什么？答：北向接口，常用 REST API。

## 速查/自测

### SNMP 三版本对比

| 版本 | 认证 | 加密 | 安全 |
|---|---|---|---|
| v1 | Community | 无 | 低 |
| v2c | Community | 无 | 低 |
| v3 | USM | AES | 高 |

### SDN 三层架构

应用层（网络应用）→ 北向 REST → 控制层（控制器）→ 南向 OpenFlow → 数据层（转发设备）。

### NFV vs SDN

NFV 网络功能软件化，SDN 控制转发分离，正交可组合。

### 5G 三场景

eMBB 大带宽、uRLLC 低时延、mMTC 大连接。

### 物联网网络层对比

NB-IoT 蜂窝授权、LoRa 免授权自建、Zigbee 短距低功耗。

### 自测题

1. SNMP Trap 用哪个端口？答：UDP 162。
2. SDN 控制器与交换机间用哪个协议？答：OpenFlow（南向接口）。
3. 5G 哪个场景适合工业控制？答：uRLLC 超可靠低时延。

一句话小结：SNMP 看版本安全、SDN 看控制转发分离、5G 看三大场景和切片、边缘计算看 UPF 下沉。

## 参考来源

- RFC 1157 SNMP v1
- RFC 3416 SNMP v2
- RFC 3414 SNMP v3 USM
- RFC 7149 SDN 概念
- ETSI NFV 架构白皮书
- 3GPP TS 23.501 5G 系统架构
