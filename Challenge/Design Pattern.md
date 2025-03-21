# 객체 지향의 5대 원칙
- **단일 책임 원칙 (Single Responsibility Principle, SRP)**
  - 클래스는 하나의 책임만 가져야 하며, 클래스에 변경이 발생하는 이유는 오직 하나여야 함.
  - 하나의 클래스로 너무 많은 기능을 담당하게 되면, 코드의 수정이 어려워지고 오류 발생 시 문제의 원인을 파악하기 어려움.
``` mermaid
classDiagram
    class Employee {
        +calculateSalary()
        +saveEmployeeData()
        +generateEmployeeReport()
    }
    
    note for Employee "잘못된 예: 하나의 클래스가 여러 책임을 가짐"
    
    class Employee2 {
        +calculateSalary()
    }
    
    class EmployeeRepository {
        +saveEmployeeData()
    }
    
    class EmployeeReportGenerator {
        +generateEmployeeReport()
    }
    
    note for Employee2 "올바른 예: 각 클래스는 하나의 책임만 가짐"
```
- **개방-폐쇄 원칙 (Open/Closed Principle, OCP)**
  - 소프트웨어 요소(클래스, 모듈, 함수 등..)는 확장에는 열려 있어야 하고, 변경에는 닫혀 있어야 함.
  - 기존 코드를 수정하지 않고도 새로운 기능을 추가할 수 있어야 함. 이는 상속, 인터페이스 또는 추상화를 통해 달성할 수 있으며, 시스템의 안정성을 높이고 버그 발생을 줄이는 데 도움을 줌.
``` mermaid
classDiagram
    class Shape {
        <<abstract>>
        +calculateArea() double
    }
    
    class Rectangle {
        -width: double
        -height: double
        +calculateArea() double
    }
    
    class Circle {
        -radius: double
        +calculateArea() double
    }
    
    class Triangle {
        -base: double
        -height: double
        +calculateArea() double
    }
    
    Shape <|-- Rectangle
    Shape <|-- Circle
    Shape <|-- Triangle
    
    note for Shape "확장에는 열려있고(새로운 도형 추가 가능)"
    note for Rectangle "변경에는 닫혀있음(기존 코드 수정 없이 확장)"
```
- **리스코프 치환 원칙 (Liskov Substitution Principle, LSP)**
  - 프로그램의 객체는 하위 타입의 인스턴스로 대체해도 프로그램의 정확성이 유지되어야 함.
  - 부모 클래스의 인스턴스를 사용하는 모든 곳에서 자식 클래스의 인스턴스로 대체했을 때, 프로그램이 올바르게 작동해야 함. 이는 상속 구조에서 예외적인 동작을 피하고, 코드 재사용성을 높이는데 기여함.
``` mermaid
classDiagram
    class Bird {
        +fly()
        +eat()
    }
    
    class Sparrow {
        +fly()
        +eat()
    }
    
    class Ostrich {
        +fly() throws CannotFlyException
        +eat()
    }
    
    class BirdFixed {
        +eat()
    }
    
    class FlyingBird {
        +fly()
    }
    
    class NonFlyingBird {
    }
    
    Bird <|-- Sparrow
    Bird <|-- Ostrich
    BirdFixed <|-- FlyingBird
    BirdFixed <|-- NonFlyingBird
    FlyingBird <|-- Sparrow2
    NonFlyingBird <|-- Ostrich2
    
    class Sparrow2 {
        +fly()
        +eat()
    }
    
    class Ostrich2 {
        +eat()
    }
    
    note for Ostrich "LSP 위반: 부모 클래스(Bird)를 대체할 수 없음"
    note for FlyingBird "LSP 준수: 올바른 계층 구조"
```
- **인터페이스 분리 원칙 (Interface Segregation Principle, ISP)**
  - 클라이언트는 자신이 사용하지 않는 인터페이스에 의존하지 않아야 함.
  - 하나의 거대한 인터페이스보다는, 목적에 맞게 세분화된 인터페이스를 사용하여 불필요한 의존성을 줄이고, 각 클래스가 필요한 기능만을 구현할 수 있게 함.
``` mermaid
classDiagram
    class AllInOnePrinter {
        <<interface>>
        +print()
        +scan()
        +fax()
        +copyDocument()
    }
    
    class BasicPrinter {
        +print()
        +scan() throws UnsupportedOperationException
        +fax() throws UnsupportedOperationException
        +copyDocument() throws UnsupportedOperationException
    }
    
    AllInOnePrinter <|.. BasicPrinter
    
    note for BasicPrinter "ISP 위반: 사용하지 않는 메서드 구현 강제"
    
    class Printer {
        <<interface>>
        +print()
    }
    
    class Scanner {
        <<interface>>
        +scan()
    }
    
    class Fax {
        <<interface>>
        +fax()
    }
    
    class Copier {
        <<interface>>
        +copyDocument()
    }
    
    class BasicPrinter2 {
        +print()
    }
    
    class AdvancedPrinter {
        +print()
        +scan()
        +fax()
        +copyDocument()
    }
    
    Printer <|.. BasicPrinter2
    Printer <|.. AdvancedPrinter
    Scanner <|.. AdvancedPrinter
    Fax <|.. AdvancedPrinter
    Copier <|.. AdvancedPrinter
    
    note for AdvancedPrinter "ISP 준수: 필요한 인터페이스만 구현"
```
- **의존 역전 원칙 (Dependency Inversion Principle, DIP)**
  - 고수준 모듈은 저수준 모듈에 의존해서는 안 되며, 둘 다 추상화에 의존해야 함.
  - 구체적인 구현이 아닌 추상화(인터페이스나 추상 클래스)에 의존함으로써, 시스템 내의 결합도를 낮추고 유연성을 높일 수 있음. 이는 변경에 강한 구조를 만들고, 테스트 용이성도 개선함.
``` mermaid
classDiagram
    class NotificationService {
        -emailSender: EmailSender
        +send(message)
    }
    
    class EmailSender {
        +sendEmail(message)
    }
    
    NotificationService --> EmailSender
    
    note for NotificationService "DIP 위반: 고수준 모듈이 저수준 모듈에 직접 의존"
    
    class NotificationService2 {
        -messageSender: MessageSender
        +send(message)
    }
    
    class MessageSender {
        <<interface>>
        +sendMessage(message)
    }
    
    class EmailSender2 {
        +sendMessage(message)
    }
    
    class SMSSender {
        +sendMessage(message)
    }
    
    class PushNotificationSender {
        +sendMessage(message)
    }
    
    NotificationService2 --> MessageSender
    MessageSender <|.. EmailSender2
    MessageSender <|.. SMSSender
    MessageSender <|.. PushNotificationSender
    
    note for NotificationService2 "DIP 준수: 고수준 모듈과 저수준 모듈 모두 추상화에 의존"
```
 
# 생성 패턴
- **싱글톤 패턴 (Singleton Pattern)**
- **팩토리 메서드 패턴 (Factory Method Pattern)**
- **추상 팩토리 패턴 (Abstract Factory Pattern)**
- **빌더 패턴 (Builder Pattern)**
- 그 외
  - 프로토타입 패턴 (Prototype Pattern)
# 구조 패턴
- **어댑터 패턴 (Adapter Pattern)**
- **퍼사드 패턴 (Facade Pattern)**
- **프록시 패턴 (Proxy Pattern)**
- 그 외
  - 브릿지 패턴(Bridge Pattern), 컴퍼지트 패턴(Composite Pattern), 데코레이터 패턴(Decorator Pattern), 플라이웨이트 패턴(Flyweight Pattern)
# 행동 패턴
- 스트레티지 패턴(Strategy Pattern), 옵저버 패턴(Observer Pattern), 스테이트 패턴(State Pattern), 비지터 패턴(Visitor Pattern), 커맨드 패턴(Command Pattern), 인터프리터 패턴(Interpreter Pattern), 이터레이터 패턴(Iterator Pattern), 미디에이터 패턴(Mediator Pattern), 메멘토 패턴(Memento Pattern), 책임 연쇄 패턴(Chain of Responsibility Pattern)
