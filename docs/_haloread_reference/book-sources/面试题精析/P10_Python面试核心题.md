---
id: 20260405142000
title: Python 面试核心题
created: 2026-04-05
updated: 2026-04-05
tags:
  - Python
  - 面试
  - 基础语法
  - 面向对象
  - 并发编程
  - 常用库
  - 高级话题
source: 100道经典Python面试题汇总 / 245道全方面Python面试题 / 自动化测试面试题
status: published
ai_generated: true
---

关联源素材：[[《100道经典Python面试题汇总》-源素材]]

# 核心观点

**Python 面试的核心在于「理解语言设计哲学 + 掌握高频知识点 + 能说清底层原理」**。Python 面试题通常围绕 **五大模块**展开：**数据类型与基础语法**（可变/不可变、深浅拷贝、装饰器、生成器）、**面向对象编程**（MRO、魔术方法、元类）、**并发编程**（GIL、多线程/多进程、asyncio）、**常用库与工具**（collections、itertools、functools）和 **高级话题**（上下文管理器、内存管理）。掌握 **15 道精选高频题** 的完整答案要点，配合 **代码示例和对比表格**，就能系统性地应对 Python 面试中的绝大多数问题。

# 知识体系总览

```mermaid
graph TD
    A[Python 面试知识体系] --> B[数据类型与基础语法 20%]
    A --> C[面向对象编程 25%]
    A --> D[并发编程 20%]
    A --> E[常用库与工具 20%]
    A --> F[高级话题 15%]

    B --> B1[可变 vs 不可变对象]
    B --> B2[深拷贝 vs 浅拷贝]
    B --> B3[*args 和 **kwargs]
    B --> B4[装饰器原理与应用]
    B --> B5[生成器 vs 迭代器]

    C --> C1[类属性 vs 实例属性]
    C --> C2[MRO 与 super]
    C --> C3[魔术方法]
    C --> C4[@property 与描述符]
    C --> C5[元类 Metaclass]

    D --> D1[GIL 全局解释器锁]
    D --> D2[threading vs multiprocessing]
    D --> D3[asyncio 异步编程]
    D --> D4[同步原语]
    D --> D5[生产者-消费者模型]

    E --> E1[collections 模块]
    E --> E2[itertools 模块]
    E --> E3[functools 模块]
    E --> E4[正则表达式 re]
    E --> E5[JSON/序列化]

    F --> F1[上下文管理器 with]
    F --> F2[内存管理 GC]
    F --> F3[内省机制]
    F -> F4[性能优化技巧]
```

# 一、数据类型与基础语法（高频 20%）

## 1. 可变对象 vs 不可变对象

### 核心概念

| 类型 | 分类 | 示例 | 特性 |
|------|------|------|------|
| **不可变** | 数值型 | int, float, complex | 创建后值不能修改 |
| **不可变** | 字符串 | str | 创建后值不能修改 |
| **不可变** | 元组 | tuple | 创建后值不能修改 |
| **不可变** | 冻结集合 | frozenset | 创建后值不能修改 |
| **可变** | 列表 | list | 可以增删改元素 |
| **可变** | 字典 | dict | 可以增删改键值对 |
| **可变** | 集合 | set | 可以增删元素 |

### 关键区别

```python
# 不可变对象：修改会创建新对象
a = 1
print(id(a))  # 140707123456789
a = a + 1     # 实际上是创建了一个新对象
print(id(a))  # 140707123456812 (不同的 ID)

# 可变对象：原地修改，ID 不变
lst = [1, 2, 3]
print(id(lst))  # 4400000000
lst.append(4)   # 原地修改
print(id(lst))  # 4400000000 (相同的 ID)
```

### 面试要点

```
💡 为什么要有不可变对象？
   • 不可变对象是 hashable 的，可以作为字典的键或集合的元素
   • 不可变对象线程安全（天然）
   • 函数参数传递时不会被意外修改
   • 可以作为默认参数值（不会出现意外共享）

⚠️ 常见陷阱：
   • 默认参数使用可变对象会导致意外行为
   • 函数内部修改了传入的可变对象会影响外部
```

## 2. 深拷贝 vs 浅拷贝

### 三种"复制"方式对比

```python
import copy

# 原始数据
original = [[1, 2], [3, 4]]

# 方式 1: 赋值（不是复制！）
assign = original          # 引用同一个对象
assign[0][0] = 999
print(original)            # [[999, 2], [3, 4]]  ← 被修改了！

# 方式 2: 浅拷贝
shallow = copy.copy(original)       # 或 original[:]
shallow[0][0] = 888
print(original)            # [[888, 2], [3, 4]]  ← 内层还是被修改！

# 方式 3: 深拷贝
deep = copy.deepcopy(original)
deep[0][0] = 777
print(original)            # [[888, 2], [3, 4]]  ✓ 不受影响
```

### 图示说明

```
原始数据：[[1, 2], [3, 4]]

赋值 (assign)：
┌─────────────────────────┐
│ assign ───────────────> │  同一个对象
│ original ─────────────> │
└─────────────────────────┘

浅拷贝 (shallow)：
┌──────────┐     ┌──────────────────────┐
│ shallow ─┼────>│ 外层新对象             │
│          │     │ [引用1, 引用2]        │
└──────────┘     └──────────────────────┘
                        │         │
                        v         v
                  ┌──────────┐ ┌──────────┐
                  │ [1, 2]   │ │ [3, 4]   │  ← 共享内层对象！
                  └──────────┘ └──────────┘

深拷贝 (deep)：
┌──────────┐     ┌──────────────────────┐
│ deep ────┼────>│ 外层新对象             │
│          │     │ [新列表1, 新列表2]     │
└──────────┘     └──────────────────────┘
                   │              │
                   v              v
             ┌──────────┐  ┌──────────┐
             │ [1, 2]   │  │ [3, 4]   │  ← 完全独立的副本！
             └──────────┘  └──────────┘
```

### 使用场景

```python
# 场景 1：需要完全独立的数据副本时用 deepcopy
import copy
data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
backup = copy.deepcopy(data)  # 修改 backup 不会影响 data

# 场景 2：只需要外层独立时用浅拷贝或切片
matrix = [[1]*3 for _ in range(3)]  # 注意：不能用 [[1]*3]*3！

# 场景 3：对于纯数值类型，直接赋值即可（因为不可变）
a = 42
b = a      # b 是新的引用，但指向同一个不可变对象
b = 43     # b 指向新对象，不影响 a
```

## 3. *args 和 **kwargs

### 基本用法

```python
def demo(*args, **kwargs):
    """
    *args: 接收任意数量的位置参数，打包成元组
    **kwargs: 接收任意数量的关键字参数，打包成字典
    """
    print(f"args (tuple): {args}")
    print(f"kwargs (dict): {kwargs}")

demo(1, 2, 3, name='Alice', age=25)
# 输出:
# args (tuple): (1, 2, 3)
# kwargs (dict): {'name': 'Alice', 'age': 25}
```

### 高级应用

```python
# 应用 1：包装器函数（保留原函数的所有参数签名）
def logging_decorator(func):
    def wrapper(*args, **kwargs):
        print(f"Calling {func.__name__} with args={args}, kwargs={kwargs}")
        result = func(*args, **kwargs)
        print(f"{func.__name__} returned {result}")
        return result
    return wrapper

# 应用 2：参数解包
args = (1, 2, 3)
kwargs = {'name': 'test'}
demo(*args, **kwargs)  # 解包传递

# 应用 3：强制关键字参数（Python 3）
def func(pos_only, /, standard, *, keyword_only):
    pass
# pos_only: 只能位置传参
# standard: 位置或关键字都可以
# keyword_only: 只能关键字传参
```

## 4. 装饰器原理与应用

### 装饰器本质

```python
"""
装饰器的本质是一个高阶函数：
  1. 接收一个函数作为参数
  2. 返回一个新函数（通常是闭包）
  3. 新函数在调用原函数前后添加额外逻辑
"""

# 手动实现装饰器
def my_decorator(func):
    def wrapper():
        print("--- 执行前 ---")
        func()
        print("--- 执行后 ---")
    return wrapper

# 使用方式 1：手动装饰
def say_hello():
    print("Hello!")

say_hello = my_decorator(say_hello)  # 手动将函数替换为装饰后的版本
say_hello()

# 使用方式 2：语法糖 @
@my_decorator
def say_hi():
    print("Hi!")

say_hi()  # 自动等价于 say_hi = my_decorator(say_hi)
```

### 带参数的装饰器

```python
import functools
import time

def repeat(times):
    """带参数的装饰器工厂"""
    def decorator(func):
        @functools.wraps(func)  # 保留原函数的元信息
        def wrapper(*args, **kwargs):
            for _ in range(times):
                result = func(*args, **kwargs)
            return result
        return wrapper
    return decorator

@repeat(times=3)
def greet(name):
    print(f"Hello, {name}!")

greet("World")  # 会打印 3 次
```

### 常用内置装饰器

```python
# @staticmethod: 静态方法（不需要实例或类）
class Math:
    @staticmethod
    def add(a, b):
        return a + b

Math.add(1, 2)  # 直接通过类调用

# @classmethod: 类方法（第一个参数是类本身 cls）
class Person:
    count = 0

    def __init__(self, name):
        self.name = name
        Person.count += 1

    @classmethod
    def get_count(cls):
        return cls.count

Person.get_count()  # 通过类调用

# @property: 属性访问器
class Circle:
    def __init__(self, radius):
        self._radius = radius

    @property
    def radius(self):
        """获取半径"""
        return self._radius

    @radius.setter
    def radius(self, value):
        if value < 0:
            raise ValueError("半径不能为负数")
        self._radius = value

c = Circle(5)
print(c.radius)   # 调用 getter
c.radius = 10     # 调用 setter
```

## 5. 生成器 vs 迭代器

### 迭代器协议

```python
"""
迭代器必须实现两个方法：
  1. __iter__(): 返回迭代器自身
  2. __next__(): 返回下一个元素，没有则抛出 StopIteration
"""

class MyIterator:
    def __init__(self, data):
        self.data = data
        self.index = 0

    def __iter__(self):
        return self  # 迭代器本身就是可迭代对象

    def __next__(self):
        if self.index >= len(self.data):
            raise StopIteration
        value = self.data[self.index]
        self.index += 1
        return value

# 使用
my_iter = MyIterator([1, 2, 3])
for item in my_iter:  # for 循环自动调用 __iter__ 和 __next__
    print(item)
```

### 生成器（更简洁的迭代器）

```python
# 方式 1：生成器函数（使用 yield 关键字）
def countdown(n):
    """生成倒计时序列"""
    while n > 0:
        yield n  # 暂停并返回值，下次从这继续
        n -= 1

gen = countdown(5)
print(next(gen))  # 5
print(next(gen))  # 4
for num in gen:   # 继续遍历剩余的
    print(num)    # 3, 2, 1

# 方式 2：生成器表达式（类似列表推导式的惰性版本）
squares = (x*x for x in range(10))  # 注意用 () 不是 []
print(list(squares))  # [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]

# 优势对比
# 列表推导式：立即生成所有元素，占用内存 O(n)
# 生成器表达式：按需生成，占用内存 O(1)
```

### 生成器的典型应用场景

```python
# 场景 1：处理大文件（逐行读取，不一次性加载到内存）
def read_large_file(file_path):
    with open(file_path, 'r') as f:
        for line in f:
            yield line.strip()

# 场景 2：无限序列
def fibonacci():
    """斐波那契数列生成器"""
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

fib = fibonacci()
print([next(fib) for _ in range(10)])  # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

# 场景 3：管道式数据处理
def pipeline():
    numbers = range(1000000)
    squares = (x*x for x in numbers)
    evens = filter(lambda x: x % 2 == 0, squares)
    small = filter(lambda x: x < 10000, evens)
    return sum(small)  # 惰性计算，内存高效
```

# 二、面向对象编程（高频 25%）

## 1. 类属性 vs 实例属性

```python
class Dog:
    species = "Canis familiaris"  # 类属性（所有实例共享）

    def __init__(self, name):
        self.name = name           # 实例属性（每个实例独有）

dog1 = Dog("Buddy")
dog2 = Dog("Max")

print(dog1.species)  # "Canis familiaris"
print(dog2.species)  # "Canis familiaris"

# 修改类属性会影响所有实例
Dog.species = "Wolf"
print(dog1.species)  # "Wolf"
print(dog2.species)  # "Wolf"

# 修改实例属性只会影响该实例（会创建同名的实例属性）
dog1.species = "Husky"  # 创建实例属性，遮蔽类属性
print(dog1.species)  # "Husky"  (实例属性)
print(dog2.species)  # "Wolf"    (类属性)
```

## 2. MRO（方法解析顺序）与 super()

### MRO 简介

```python
"""
MRO (Method Resolution Order)：方法解析顺序
Python 3 使用 C3 算法确定多重继承时的方法查找顺序
可以通过 __mro__ 或 mro() 查看
"""

class A:
    def method(self):
        print("A")

class B(A):
    def method(self):
        print("B")

class C(A):
    def method(self):
        print("C")

class D(B, C):  # 多重继承
    pass

d = D()
d.method()  # 输出 "B"（先找 B，再找 C，最后找 A）
print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)
```

### super() 的正确使用

```python
class Animal:
    def __init__(self, name):
        self.name = name

class Dog(Animal):
    def __init__(self, name, breed):
        super().__init__(name)  # 调用父类的 __init__
        self.breed = breed

# ⚠️ 常见错误
class Base:
    def __init__(self):
        print("Base init")

class A(Base):
    def __init__(self):
        Base.__init__(self)  # ❌ 硬编码父类名，不推荐

class B(Base):
    def __init__(self):
        super().__init__()   # ✅ 推荐，自动按 MRO 顺序调用
```

## 3. 魔术方法（双下划线方法）

### 常用魔术方法速查表

| 方法 | 触发时机 | 示例 |
|------|---------|------|
| `__init__` | 创建实例时 | `obj = MyClass()` |
| `__str__` | `str()` 或 `print()` 时 | `print(obj)` |
| `__repr__` | `repr()` 或交互式解释器 | `obj` |
| `__len__` | `len()` 时 | `len(obj)` |
| `__getitem__` | 索引访问 `obj[key]` | `obj[0]` |
| `__setitem__` | 赋值 `obj[key] = value` | `obj[0] = 1` |
| `__call__` | 对象像函数一样调用 | `obj()` |
| `__eq__` | `==` 比较 | `obj1 == obj2` |
| `__lt__`, `__gt__` | `<`, `>` 比较 | `obj1 < obj2` |
| `__add__` | `+` 运算符 | `obj1 + obj2` |
| `__enter__`, `__exit__` | `with` 语句 | `with obj:` |
| `__iter__`, `__next__` | 迭代 | `for x in obj:` |

### 示例：实现一个向量类

```python
class Vector:
    def __init__(self, *components):
        self.components = list(components)

    def __repr__(self):
        return f"Vector({self.components})"

    def __len__(self):
        return len(self.components)

    def __getitem__(self, index):
        return self.components[index]

    def __setitem__(self, index, value):
        self.components[index] = value

    def __add__(self, other):
        if len(self) != len(other):
            raise ValueError("维度不匹配")
        return Vector(*(a + b for a, b in zip(self.components, other.components)))

    def __eq__(self, other):
        return self.components == other.components

v1 = Vector(1, 2, 3)
v2 = Vector(4, 5, 6)
v3 = v1 + v2
print(v3)  # Vector([5, 7, 9])
print(len(v3))  # 3
print(v3[0])  # 5
```

## 4. @property 与描述符协议

### property 进阶用法

```python
class Temperature:
    def __init__(self, celsius=0):
        self._celsius = celsius

    @property
    def celsius(self):
        return self._celsius

    @celsius.setter
    def celsius(self, value):
        if value < -273.15:
            raise ValueError("温度低于绝对零度")
        self._celsius = value

    @property
    def fahrenheit(self):
        return self.celsius * 9/5 + 32

    @fahrenheit.setter
    def fahrenheit(self, value):
        self.celsius = (value - 32) * 5/9

t = Temperature()
t.celsius = 100
print(t.fahrenheit)  # 212.0
t.fahrenheit = 32
print(t.celsius)     # 0.0
```

### 描述符协议（底层原理）

```python
"""
描述符是实现 property 的底层机制
只要实现了以下任一方法的类就是描述符：
  - __get__(self, obj, objtype=None)
  - __set__(self, obj, value)
  - __delete__(self, obj)
"""

class ValidatedAttribute:
    """自定义描述符：验证属性值"""

    def __init__(self, validator):
        self.validator = validator
        self.name = None

    def __set_name__(self, owner, name):
        self.name = f"_{name}"

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return getattr(obj, self.name, None)

    def __set__(self, obj, value):
        validated_value = self.validator(value)
        setattr(obj, self.name, validated_value)

def validate_positive(value):
    if value <= 0:
        raise ValueError("必须是正数")
    return value

class Product:
    price = ValidatedAttribute(validate_positive)
    quantity = ValidatedAttribute(validate_positive)

p = Product()
p.price = 99.99      # ✅
p.price = -10        # ❌ ValueError
```

## 5. 元类（Metaclass）入门

### 元类是什么？

```
💡 元类比喻：
   类是创建对象的模板
   元类是创建类的模板
   即：元类 → 类 → 实例

📌 默认情况下，所有类的元类都是 type
   class MyClass: ...  等价于  MyClass = type('MyClass', (), {...})
```

### 简单示例

```python
# 方式 1：使用 type() 动态创建类
MyClass = type('MyClass', (), {
    'attr': 42,
    'method': lambda self: print(self.attr)
})

# 方式 2：定义元类
class Meta(type):
    def __new__(cls, name, bases, namespace):
        print(f"创建类: {name}")
        # 可以在这里修改 namespace
        namespace['created_at'] = datetime.now()
        return super().__new__(cls, name, bases, namespace)

class MyClass(metaclass=Meta):
    pass

# 输出: 创建类: MyClass

# 实际应用：自动注册子类
registry = []

class PluginMeta(type):
    def __new__(cls, name, bases, namespace):
        new_class = super().__new__(cls, name, bases, namespace)
        registry.append(new_class)  # 自动注册
        return new_class

class PluginA(metaclass=PluginMeta):
    pass

class PluginB(metaclass=PluginMeta):
    pass

print(registry)  # [<class 'PluginA'>, <class 'PluginB'>]
```

# 三、并发编程（高频 20%）

## 1. GIL（全局解释器锁）

### GIL 是什么？

```
💡 GIL (Global Interpreter Lock)：
   • Python 解释器级别的互斥锁
   • 同一时刻只有一个线程能执行 Python 字节码
   • 目的是保护 CPython 的内存管理（引用计数）线程安全

⚠️ 影响：
   • CPU 密集型任务：多线程无法真正并行（受 GIL 限制）
   • I/O 密集型任务：多线程可以提升效率（I/O 时释放 GIL）

✅ 解决方案：
   • CPU 密集型：使用 multiprocessing（多进程，绕过 GIL）
   • I/O 密集型：threading 或 asyncio 都可以
   • 计算密集：使用 C 扩展/Numba/Cython
```

### GIL 的行为示例

```python
import threading
import time

# CPU 密集型任务（GIL 导致无法并行）
def cpu_bound(n):
    count = 0
    for i in range(n):
        count += 1
    return count

# I/O 密集型任务（I/O 时释放 GIL）
def io_bound(duration):
    time.sleep(duration)  # sleep 会释放 GIL
    return duration

# 测试 CPU 密集型
start = time.time()
threads = []
for _ in range(4):
    t = threading.Thread(target=cpu_bound, args=(10000000,))
    threads.append(t)
    t.start()

for t in threads:
    t.join()

print(f"CPU密集型（4线程）耗时: {time.time()-start:.2f}s")
# 结果：几乎与单线程相同（甚至更慢，因为有切换开销）
```

## 2. threading vs multiprocessing

### 对比总结

| 特性 | threading | multiprocessing |
|------|-----------|------------------|
| **执行单元** | 线程（共享内存） | 进程（独立内存） |
| **GIL 影响** | 受限（同一时间只有一个线程运行） | 不受限（每个进程有独立 GIL） |
| **通信方式** | 共享变量（需加锁） | Queue、Pipe、Manager |
| **适用场景** | I/O 密集型 | CPU 密集型 |
| **开销** | 低（轻量级） | 高（进程创建开销大） |
| **调试难度** | 较难（竞态条件） | 相对容易 |

### 使用示例

```python
import threading
import multiprocessing
import time

# ===== Threading 示例 =====
def worker_thread(name, delay):
    print(f"[Thread-{name}] 开始工作")
    time.sleep(delay)
    print(f"[Thread-{name}] 完成")

threads = []
for i in range(5):
    t = threading.Thread(target=worker_thread, args=(i, 1))
    threads.append(t)
    t.start()

for t in threads:
    t.join()

# ===== Multiprocessing 示例 =====
def worker_process(name, delay):
    print(f"[Process-{name}] 开始工作（PID: {multiprocessing.current_process().pid}）")
    time.sleep(delay)
    print(f"[Process-{name}] 完成")

if __name__ == '__main__':  # Windows 必须加这个保护
    processes = []
    for i in range(5):
        p = multiprocessing.Process(target=worker_process, args=(i, 1))
        processes.append(p)
        p.start()

    for p in processes:
        p.join()
```

## 3. asyncio 异步编程基础

### 核心概念

```python
"""
asyncio 关键概念：

1. async def: 定义协程函数（返回协程对象）
2. await: 挂起当前协程，等待另一个协程完成
3. asyncio.run(): 运行协程的入口
4. asyncio.gather(): 并发运行多个协程
5. async with / async for: 异步上下文管理器和迭代器
"""

import asyncio
import aiohttp  # 异步 HTTP 库

async def fetch_url(url):
    """异步获取 URL 内容"""
    print(f"开始请求: {url}")
    await asyncio.sleep(1)  # 模拟网络延迟
    print(f"完成请求: {url}")
    return f"{url} 的内容"

async def main():
    # 并发执行多个任务
    tasks = [
        fetch_url("https://api.example.com/1"),
        fetch_url("https://api.example.com/2"),
        fetch_url("https://api.example.com/3"),
    ]

    results = await asyncio.gather(*tasks)
    print(results)

asyncio.run(main())
```

### 同步 vs 异步对比

```python
# 同步版本（总耗时 = 所有请求时间之和）
import requests
import time

def sync_fetch(urls):
    start = time.time()
    results = []
    for url in urls:
        resp = requests.get(url)
        results.append(resp.text)
    print(f"同步耗时: {time.time()-start:.2f}s")
    return results

# 异步版本（总耗时 ≈ 最慢的那个请求时间）
async def async_fetch(urls):
    import aiohttp
    start = time.time()
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
        results = [await resp.text() for resp in responses]
    print(f"异步耗时: {time.time()-start:.2f}s")
    return results

# 假设每个请求 1 秒，3 个请求：
# 同步：~3 秒
# 异步：~1 秒（3 个请求同时进行）
```

## 4. 锁、信号量、事件、条件变量

```python
import threading

# 1. Lock（互斥锁）：保证同一时间只有一个线程访问资源
lock = threading.Lock()

def safe_increment(counter):
    with lock:  # 自动获取和释放锁
        counter.value += 1

# 2. Semaphore（信号量）：限制同时访问资源的线程数量
semaphore = threading.Semaphore(3)  # 最多 3 个线程同时访问

def limited_access(resource_id):
    with semaphore:
        print(f"访问资源 {resource_id}")

# 3. Event（事件）：线程间通知机制
event = threading.Event()

def waiter():
    print("等待事件...")
    event.wait()  # 阻塞直到事件被设置
    print("事件已触发，继续执行")

def setter():
    time.sleep(2)
    event.set()  # 触发事件

# 4. Condition（条件变量）：复杂的线程间协调
condition = threading.Condition()

def producer():
    with condition:
        print("生产数据")
        condition.notify()  # 通知消费者
        condition.wait()    # 等待消费者确认

def consumer():
    with condition:
        condition.wait()    # 等待生产者通知
        print("消费数据")
        condition.notify()  # 通知生产者
```

## 5. 生产者-消费者模型

```python
import threading
import queue
import time
import random

# 使用 queue.Queue（线程安全队列）
q = queue.Queue(maxsize=10)

def producer(id):
    for i in range(5):
        item = f"产品-P{id}-{i}"
        q.put(item)  # 如果队列满，会阻塞
        print(f"生产者 {id} 生产了: {item}")
        time.sleep(random.random())

def consumer(id):
    while True:
        item = q.get()  # 如果队列空，会阻塞
        print(f"消费者 {id} 消费了: {item}")
        q.task_done()  # 标记任务完成
        time.sleep(random.random())

# 启动生产者和消费者
producers = [threading.Thread(target=producer, args=(i,)) for i in range(2)]
consumers = [threading.Thread(target=consumer, args=(i,)) for i in range(3)]

for p in producers:
    p.start()
for c in consumers:
    c.start()

q.join()  # 等待所有任务完成
```

# 四、常用库与工具（中等 20%）

## 1. collections 模块

```python
from collections import Counter, defaultdict, deque, namedtuple

# Counter：计数器
words = ['apple', 'banana', 'apple', 'orange', 'banana', 'apple']
word_counts = Counter(words)
print(word_counts.most_common(2))  # [('apple', 3), ('banana', 2)]

# defaultdict：带默认值的字典
dd = defaultdict(list)
dd['fruits'].append('apple')  # 不需要先检查 key 是否存在
dd['fruits'].append('banana')

# deque：双端队列（高效的头尾操作）
dq = deque([1, 2, 3])
dq.appendleft(0)   # 左侧添加: deque([0, 1, 2, 3])
dq.pop()            # 右侧弹出: 3
dq.popleft()        # 左侧弹出: 0

# namedtuple：命名元组（类似轻量级类）
Point = namedtuple('Point', ['x', 'y'])
p = Point(10, 20)
print(p.x, p.y)  # 10 20
```

## 2. itertools 模块

```python
from itertools import permutations, combinations, chain, groupby

# permutations：排列（有序）
list(permutations([1, 2, 3], 2))
# [(1, 2), (1, 3), (2, 1), (2, 3), (3, 1), (3, 2)]

# combinations：组合（无序）
list(combinations([1, 2, 3], 2))
# [(1, 2), (1, 3), (2, 3)]

# chain：连接多个可迭代对象
list(chain([1, 2], [3, 4], [5]))
# [1, 2, 3, 4, 5]

# groupby：分组（需要先排序）
data = sorted([('a', 1), ('b', 2), ('a', 3), ('b', 4)])
for key, group in groupby(data, key=lambda x: x[0]):
    print(key, list(group))
# a [('a', 1), ('a', 3)]
# b [('b', 2), ('b', 4)]
```

## 3. functools 模块

```python
from functools import lru_cache, partial, wraps

# lru_cache：LRU 缓存装饰器（记忆化）
@lru_cache(maxsize=None)  # 无限缓存
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(100))  # 极快（缓存了中间结果）

# partial：部分应用（固定某些参数）
import operator
multiply_by_2 = partial(operator.mul, 2)
print(multiply_by_2(5))  # 10

# wraps：保留被装饰函数的元信息
def my_decorator(f):
    @wraps(f)  # 保留原函数的 __name__, __doc__ 等
    def wrapper(*args, **kwargs):
        return f(*args, **kwargs)
    return wrapper
```

## 4. 正则表达式 re 模块

```python
import re

text = "我的邮箱是 test@example.com 和 admin@test.org"

# 常用方法
pattern = r'\w+@\w+\.\w+'  # 匹配邮箱

re.findall(pattern, text)     # ['test@example.com', 'admin@test.org']
re.search(pattern, text).group()  # 'test@example.com' (第一个匹配)
re.sub(pattern, '[REDACTED]', text)  # 替换

# 编译正则（提高复用效率）
email_pattern = re.compile(r'\w+@\w+\.\w+')
email_pattern.findall(text)

# 分组捕获
date_pattern = r'(\d{4})-(\d{2})-(\d{2})'
match = re.search(date_pattern, "今天是 2024-01-15")
match.group(0)  # '2024-01-15'
match.group(1)  # '2024' (年)
match.group(2)  # '01' (月)
match.group(3)  # '15' (日)
```

## 5. JSON/序列化

```python
import json
import pickle

# JSON 序列化（跨语言，只能处理基本类型）
data = {'name': 'Alice', 'age': 25, 'scores': [90, 85, 92]}

json_str = json.dumps(data, ensure_ascii=False, indent=2)
parsed = json.loads(json_str)

# pickle 序列化（Python 专用，可以处理几乎所有类型）
class Person:
    def __init__(self, name, age):
        self.name = name
        self.age = age

person = Person("Bob", 30)
pickled = pickle.dumps(person)
restored = pickle.loads(pickled)
print(restored.name)  # Bob

# ⚠️ 安全警告：不要反序列化不受信任的数据（可能执行恶意代码）
```

# 五、高级话题（进阶 15%）

## 1. 上下文管理器（with 语句）

### 自定义上下文管理器

```python
# 方式 1：基于类的上下文管理器
class Timer:
    def __enter__(self):
        self.start = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.elapsed = time.time() - self.start
        print(f"耗时: {self.elapsed:.2f}s")
        return False  # True 表示抑制异常

with Timer() as t:
    time.sleep(1)
    # 自动打印耗时

# 方式 2：基于 contextlib 的简单写法
from contextlib import contextmanager

@contextmanager
def managed_resource(path):
    f = open(path, 'r')
    try:
        yield f  # 提供给 as 子句的对象
    finally:
        f.close()  # 确保关闭

with managed_resource('file.txt') as f:
    content = f.read()
```

## 2. 内存管理（引用计数 + GC）

```python
import sys
import gc

# 引用计数
a = []           # a 引用 [], refcount = 1
b = a            # b 也引用 [], refcount = 2
del a            # refcount = 1
print(sys.getrefcount(b))  # 2 (getrefcount 本身也算一次引用)

# 循环引用问题
class Node:
    def __init__(self):
        self.ref = None

a = Node()
b = Node()
a.ref = b  # a 引用 b
b.ref = a  # b 引用 a（循环引用！）
del a, b   # refcount 都变为 0？不，互相引用导致不为 0

gc.collect()  # 强制垃圾回收，解决循环引用

# __del__ 析构器
class Resource:
    def __del__(self):
        print("资源被释放")

r = Resource()
del r  # 打印 "资源被释放"
```

## 3. 内省机制

```python
class MyClass:
    class_attr = "我是类属性"

    def __init__(self):
        self.instance_attr = "我是实例属性"

    def my_method(self):
        pass

obj = MyClass()

# getattr / setattr / hasattr
hasattr(obj, 'instance_attr')  # True
getattr(obj, 'instance_attr')  # "我是实例属性"
setattr(obj, 'new_attr', '新值')

# 动态获取所有属性和方法
dir(obj)                    # 列出所有属性和方法
vars(obj)                   # 返回 __dict__
obj.__dict__                # 实例属性字典
MyClass.__dict__            # 类属性字典

# 检查类型
isinstance(obj, MyClass)    # True
issubclass(MyClass, object) # True
type(obj)                   # <class '__main__.MyClass'>

# callable：是否可调用
callable(obj.my_method)     # True
callable(obj)               # False
```

## 4. Python 性能优化技巧

```python
# 技巧 1：使用内置函数和库（比手写循环快很多）
# ❌ 慢
result = []
for i in range(1000):
    result.append(i * 2)

# ✅ 快
result = [i * 2 for i in range(1000)]  # 列表推导式
result = map(lambda x: x * 2, range(1000))

# 技巧 2：使用局部变量（比全局变量快）
def fast_function():
    local_len = len  # 将内置函数绑定到局部变量
    data = list(range(10000))
    return local_len(data)

# 技巧 3：字符串拼接用 join（不用 +）
# ❌ 慢
s = ""
for word in words:
    s += word  # 每次都创建新字符串

# ✅ 快
s = "".join(words)

# 技巧 4：使用生成器节省内存
# ❌ 占用大量内存
all_squares = [x**2 for x in range(1000000)]

# ✅ 内存高效
squares_gen = (x**2 for x in range(1000000))

# 技巧 5：适当使用 NumPy 处理数值计算
import numpy as np
arr = np.arange(1000000)
arr_squared = arr ** 2  # 向量化操作，极快
```

# 六、精选高频面试题 15 道（附答案要点）

## Q1: Python 2 和 Python 3 的主要区别？

```
答案要点：
1. print 语句 vs 函数：Python 2 用 print "hello"，Python 3 用 print("hello")
2. 整除行为：Python 2 中 3/2 = 1（整数除法），Python 3 中 3/2 = 1.5（真除法）
3. Unicode：Python 2 默认 ASCII，Python 3 默认 UTF-8
4. range：Python 2 返回列表，Python 3 返回迭代器（更省内存）
5. input/raw_input：Python 2 有 raw_input()，Python 3 统一为 input()
6. 异常语法：Python 2 except Exception, e:，Python 3 except Exception as e:
7. 类的新式/旧式：Python 3 只有新式类（继承自 object）
8. GIL 改进：Python 3.2+ 引入了新的 GIL 实现
```

## Q2: 什么是 GIL？它有什么影响？

```
答案要点：
1. GIL = Global Interpreter Lock（全局解释器锁）
2. 它是 CPython 解释器层面的互斥锁
3. 同一时刻只有一个线程能执行 Python 字节码
4. 影响：
   - CPU 密集型：多线程无法利用多核（应使用 multiprocessing）
   - I/O 密集型：多线程有效（I/O 操作会释放 GIL）
5. 解决方案：
   - multiprocessing（多进程）
   - asyncio（异步 I/O）
   - C 扩展（绕过 GIL）
   - 其他解释器（Jython, IronPython 无 GIL）
```

## Q3: 装饰器是什么？请手写一个简单的装饰器。

```
答案要点：
1. 本质：高阶函数，接收函数返回函数
2. 通常使用闭包和 @ 语法糖
3. 要点：使用 functools.wraps 保留原函数元信息

示例：（参见上文"装饰器原理与应用"章节）
```

## Q4: 生成器和迭代器的区别？

```
答案要点：
1. 迭代器：实现 __iter__ 和 __next__ 协议的对象
2. 生成器：特殊的迭代器，使用 yield 关键字创建
3. 区别：
   - 生成器更简洁（不需要手动实现 __next__）
   - 生成器是惰性的（按需生成，节省内存）
   - 生成器只能遍历一次（状态会被消耗）
4. 适用场景：大数据处理、无限序列、管道式数据处理
```

## Q5: 深拷贝和浅拷贝的区别？

```
答案要点：
1. 赋值 (=)：只是创建引用，不复制对象
2. 浅拷贝 (copy/copy())：创建新对象，但内部对象仍是引用
3. 深拷贝 (copy.deepcopy())：递归复制所有层级的对象
4. 选择依据：
   - 需要完全独立的数据 → 深拷贝
   - 只需要外层独立 → 浅拷贝
   - 数据都是不可变的 → 直接赋值即可
```

## Q6: *args 和 **kwargs 的作用？

```
答案要点：
1. *args：接收任意数量的位置参数，打包为元组
2. **kwargs：接收任意数量的关键字参数，打包为字典
3. 用途：
   - 包装器函数（保持原函数接口不变）
   - 参数解包传递
   - 更灵活的 API 设计
4. 注意：* 必须在 ** 前面
```

## Q7: 什么是闭包（Closure）？

```
答案要点：
1. 定义：内部函数引用了外部函数的变量，即使外部函数已返回
2. 条件：
   - 必须有嵌套函数
   - 内部函数必须引用外部函数的变量
   - 外部函数必须返回内部函数
3. 用途：
   - 数据封装（类似私有变量）
   - 装饰器的实现基础
   - 工厂函数
4. 示例：（参见上文生成器或装饰器部分）
```

## Q8: 如何实现单例模式？

```
答案要点：
1. 使用模块（Python 模块天然单例）
2. 使用 __new__ 方法
3. 使用装饰器
4. 使用类变量（最常用）

示例代码：
class Singleton:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
```

## Q9: 列表推导式和生成器表达式的区别？

```
答案要点：
1. 语法：[] vs ()
2. 列表推导式：立即生成所有元素，占用 O(n) 内存
3. 生成器表达式：惰性求值，按需生成，O(1) 内存
4. 选择：
   - 需要多次访问或索引 → 列表推导式
   - 只需遍历一次或数据量大 → 生成器表达式
```

## Q10: Python 的垃圾回收机制是怎样的？

```
答案要点：
1. 主要机制：引用计数为主，标记-清除 + 分代收集为辅
2. 引用计数：
   - 每个对象维护一个引用计数
   - 计数为 0 时立即回收
   - 优点：实时、简单；缺点：无法处理循环引用
3. 循环引用解决方案：
   - 标记-清除算法
   - 分代回收（0 代、1 代、2 代）
4. 手动控制：gc.collect(), gc.disable(), gc.enable()
```

## Q11: 什么是鸭子类型（Duck Typing）？

```
答案要点：
1. 概念："如果它走起来像鸭子，叫起来像鸭子，那它就是鸭子"
2. 含义：不关注对象的类型，只关注对象是否有特定的方法/属性
3. 与静态类型的区别：
   - 静态类型（如 Java）：编译时检查类型
   - 鸭子类型（Python）：运行时检查行为
4. 优点：灵活、代码简洁；缺点：可能隐藏错误
5. 示例：
   def quack(obj):
       obj.quack()  # 只要对象有 quack 方法就行，不管什么类型
```

## Q12: @property 的作用和使用场景？

```
答案要点：
1. 作用：将方法伪装成属性，提供 getter/setter/deleter
2. 优势：
   - 保持接口一致性（对外看起来像属性访问）
   - 可以添加验证逻辑
   - 可以实现计算属性（懒加载）
3. 使用场景：
   - 属性验证（如范围检查）
   - 只读属性（只提供 getter）
   - 计算属性（每次访问都重新计算）
   - 向后兼容（将公开属性改为属性而不破坏接口）
```

## Q13: 如何处理 Python 中的异常？

```
答案要点：
1. 基本语法：try-except-finally-else
2. 最佳实践：
   - 只捕获预期的异常（不要裸 except）
   - 使用具体的异常类型（不用 Exception）
   - 在 finally 中清理资源（或使用 with）
   - 使用 else 处理无异常的情况
3. 自定义异常：继承自 Exception
4. 日志记录：不要吞掉异常，至少记录日志
5. 上下文管理器：用于资源管理（替代 try-finally）
```

## Q14: 什么是 Python 的 MRO（方法解析顺序）？

```
答案要点：
1. MRO = Method Resolution Order
2. 用于解决多重继承时的方法查找顺序
3. Python 3 使用 C3 线性化算法
4. 查看方式：ClassName.__mro__ 或 ClassName.mro()
5. 规则：
   - 子类优先于父类
   - 多个父类按定义顺序查找
   - 保证单调性（不会出现顺序矛盾）
6. super() 的作用：按照 MRO 顺序调用父类方法
```

## Q15: 如何提高 Python 程序的性能？

```
答案要点：
1. 算法优化：选择合适的数据结构和算法（最重要！）
2. 使用内置函数和库：map/filter/reduce 等
3. 列表推导式和生成器表达式
4. 局部变量比全局变量快
5. 字符串拼接用 join
6. 使用缓存：@lru_cache
7. 使用 NumPy/Pandas 处理数值计算
8. 使用 Cython/Numba 加速热点代码
9. 多进程处理 CPU 密集型任务
10. 异步 I/O 处理网络请求
11. 使用 PyPy 解释器（JIT 编译）
12. Profile 分析瓶颈：cProfile, line_profiler
```

# 关联阅读

- [[P11_Java面试核心题]] - Java 面试核心题（对比学习）
- [[P08_BFS_DFS专题]] - BFS/DFS 算法专题
- [[T13_Python进阶]] - Python 进阶知识（如有）
- [[P00_刷题方法论与思维框架]] - 刷题方法论总览
