# 모놀리식 아키텍처 (Monolithic Architecture)
- **challenge** <br>
  - 전체 애플리케이션이 단일 코드베이스로 구성되어 하나의 실행 가능한 유닛으로 배포되는 전통적인 아키텍처
- **pros** <br>
  - 개발 초기 단계에서 구현이 간단함
  - 배포와 테스트가 단순함
  - 낮은 초기 복잡성
  - 크로스 커팅 관심사(로깅, 캐싱, 보안)를 쉽게 구현 가능
- **cons** <br>
  - 규모가 커질수록 복잡도 증가
  - 전체 애플리케이션을 매번 재배포해야 함
  - 특정 부분만 확장하기 어려움
  - 새로운 기술 도입이 어려움
``` mermaid
graph TB
    subgraph "모놀리식 애플리케이션"
        UI[사용자 인터페이스 계층]
        BL[비즈니스 로직 계층]
        DL[데이터 액세스 계층]
        
        UI --> BL
        BL --> DL
    end
    
    DB[(데이터베이스)]
    
    DL --> DB
    
    Client[클라이언트] --> UI
```

# 마이크로서비스 아키텍처 (Microservices Architecture)
- **challenge** <br>
  - 애플리케이션을 작고 독립적인 서비스로 구성되며, 각 서비스는 자체 프로세스에서 실행되고 가벼운 통신 메커니즘(주로 HTTP API)을 통해 통신
- **pros** <br>
  - 서비스별 독립적 개발, 배포, 확장 가능
  - 다양한 기술 스택 사용 가능
  - 결함 격리 (한 서비스의 장애가 전체에 영향을 미치지 않음)
  - 대규모 조직에서 팀별 분업이 용이함
- **cons** <br>
  - 분산 시스템의 복잡성 증가
  - 서비스 간 통신 오버헤드
  - 트랜잭션 관리와 데이터 일관성 유지가 어려움
  - 테스트와 디버깅이 복잡함
  - 운영 오버헤드 증가
``` mermaid
graph TD
    subgraph "API Gateway"
        AG[API Gateway]
    end
    
    subgraph "User Service"
        US[User Service]
        UDB[(User DB)]
    end
    
    subgraph "Order Service"
        OS[Order Service]
        ODB[(Order DB)]
    end
    
    subgraph "Payment Service"
        PS[Payment Service]
        PDB[(Payment DB)]
    end
    
    subgraph "Inventory Service"
        IS[Inventory Service]
        IDB[(Inventory DB)]
    end
    
    subgraph "Notification Service"
        NS[Notification Service]
        NDB[(Notification DB)]
    end
    
    C[Client] --> AG
    AG --> US
    AG --> OS
    AG --> PS
    AG --> IS
    
    OS --> PS
    OS --> IS
    PS --> NS
    OS --> NS
    
    US --> UDB
    OS --> ODB
    PS --> PDB
    IS --> IDB
    NS --> NDB
```

# 모듈러 모놀리식 아키텍처 (Modular Monolith)
- **challenge** <br>
  - 단일 애플리케이션이지만 내부적으로 모듈화가 잘 되어 있는 구조. 각 모듈은 명확한 경계와 책임을 가지며 내부적으로 느슨하게 결합
- **pros** <br>
  - 개발 및 배포의 단순성
  - 낮은 네트워크 오버헤드
  - 마이크로서비스보다 간단한 트랜잭션 처리
  - 모듈 간 경계가 명확하여 유지보수성 향상
- **cons** <br>
  - 전체 애플리케이션 배포 필요
  - 기술 스택 제한
  - 규모가 커지면 복잡성 증가 가능성
``` mermaid
graph TD
    Client[클라이언트] --> API[API Layer]
    
    subgraph "모듈러 모놀리스"
        API --> M1[사용자 모듈]
        API --> M2[주문 모듈]
        API --> M3[상품 모듈]
        API --> M4[결제 모듈]
        
        M1 --> I1[사용자 인터페이스]
        M2 --> I2[주문 인터페이스]
        M3 --> I3[상품 인터페이스]
        M4 --> I4[결제 인터페이스]
        
        I1 --- M1Core[사용자 핵심 로직]
        I2 --- M2Core[주문 핵심 로직]
        I3 --- M3Core[상품 핵심 로직]
        I4 --- M4Core[결제 핵심 로직]
        
        M2Core --> I1
        M2Core --> I3
        M2Core --> I4
    end
    
    DB[(공유 데이터베이스)]
    M1Core --> DB
    M2Core --> DB
    M3Core --> DB
    M4Core --> DB
```

# 레이어드 아키텍처 (Layered Architecture)
- **challenge** <br>
  - 애플리케이션을 수평적 계층으로 구성하는 방식으로, 각 계층은 특정 역할을 담당하며 하위 계층에 대한 의존성을 가짐
- **pros** <br>
  - 관심사의 분리가 명확함
  - 코드 재사용성 증가
  - 테스트 용이성
  - 유지보수와 확장이 상대적으로 쉬움
- **cons** <br>
  - 지나친 계층화로 성능 저하 가능성
  - 변경 전파가 모든 계층에 영향을 미칠 수 있음
  - 비즈니스 로직이 여러 계층에 분산될 위험
  - 실제 구현에서 계층 간 경계가 모호해질 수 있음
``` mermaid
graph TB
    subgraph "4-계층 아키텍처"
        P[표현 계층<br/>Presentation Layer]
        A[응용 계층<br/>Application Layer]
        D[도메인 계층<br/>Domain Layer]
        I[인프라 계층<br/>Infrastructure Layer]
        
        P --> A
        A --> D
        A --> I
        D --> I
    end
    
    Client[클라이언트] --> P
    I --> DB[(데이터베이스)]
    I --> ES[외부 서비스]
    I --> FileSystem[파일 시스템]
```

# 헥사고날 아키텍처 (Hexagonal Architecture / Ports and Adapters)
- **challenge** <br>
  - 비즈니스 로직을 외부 요소(UI, 데이터베이스 등)로부터 격리하여 애플리케이션의 핵심을 보호하는 아키텍처
- **pros** <br>
  - 비즈니스 로직의 독립성 보장
  - 외부 시스템 변경에 대한 유연성
  - 테스트 용이성 (목(mock) 어댑터 사용)
  - 기술적 부채 최소화
- **cons** <br>
  - 초기 설계 복잡도 증가
  - 소규모 프로젝트에서는 과도할 수 있음
  - 인터페이스 설계에 대한 높은 이해도 필요
  - 추가적인 추상화 계층으로 인한 오버헤드
``` mermaid
graph TB
    subgraph "Hexagonal Architecture"
        subgraph "Domain Core"
            BL[비즈니스 로직]
        end
        
        subgraph "Primary Adapters (Driving)"
            RestAPI[REST API 컨트롤러]
            CLI[CLI 인터페이스]
            Events[이벤트 리스너]
        end
        
        subgraph "Secondary Adapters (Driven)"
            DB_Adapter[DB 어댑터]
            ExternalAPI[외부 API 어댑터]
            MessageQueue[메시지 큐 어댑터]
        end
        
        subgraph "Ports"
            In_Port[입력 포트<br/>인터페이스]
            Out_Port[출력 포트<br/>인터페이스]
        end
        
        RestAPI --> In_Port
        CLI --> In_Port
        Events --> In_Port
        
        In_Port --> BL
        BL --> Out_Port
        
        Out_Port --> DB_Adapter
        Out_Port --> ExternalAPI
        Out_Port --> MessageQueue
    end
    
    User[사용자] --> RestAPI
    Admin[관리자] --> CLI
    ExternalSys[외부 시스템] --> Events
    
    DB_Adapter --> Database[(데이터베이스)]
    ExternalAPI --> ExtServices[외부 서비스]
    MessageQueue --> Queue[메시지 큐]
```

# CQRS (Command Query Responsibility Segregation)
- **challenge** <br>
  - 데이터를 변경하는 명령(Command)과 데이터를 조회하는 쿼리(Query)를 분리하는 패턴으로, 각각 다른 모델과 다른 데이터 저장소를 사용할 수 있음
- **pros** <br>
  - 읽기와 쓰기 작업에 대한 최적화 가능
  - 확장성 향상 (읽기/쓰기 독립적 확장)
  - 복잡한 도메인 모델 단순화
  - 이벤트 소싱과 결합 시 시너지 효과
- **cons** <br>
  - 구현 복잡도 증가
  - 데이터 일관성 유지 관리 필요
  - 두 모델 간 데이터 동기화 필요
  - 작은 애플리케이션에서는 오버엔지니어링 우려
``` mermaid
graph TD
    Client[클라이언트] --> CmdAPI[명령 API]
    Client --> QryAPI[쿼리 API]
    
    subgraph "명령 측 (Write Side)"
        CmdAPI --> CmdHandlers[명령 핸들러]
        CmdHandlers --> Domain[도메인 모델]
        Domain --> CmdRepo[명령 리포지토리]
        CmdRepo --> WriteDB[(Write DB)]
    end
    
    subgraph "쿼리 측 (Read Side)"
        QryAPI --> QryHandlers[쿼리 핸들러]
        QryHandlers --> ReadModels[읽기 모델]
        ReadModels --> QryRepo[쿼리 리포지토리]
        QryRepo --> ReadDB[(Read DB)]
    end
    
    WriteDB -- "이벤트/동기화" --> SyncMech[동기화 메커니즘]
    SyncMech --> ReadDB
```

# 서비스 지향 아키텍처 (SOA)
- **challenge** <br>
  - 비즈니스 기능을 서비스라는 단위로 모듈화하여 구성하는 아키텍처. 기업 비즈니스 요구사항을 중심으로 재사용 가능한 서비스를 구성
- **pros** <br>
  - 비즈니스 중심적 접근
  - 서비스 재사용성 높음
  - 레거시 시스템과의 통합이 용이
- **cons** <br>
  - 중앙화된 ESB(Enterprise Service Bus)가 병목현상이 될 수 있음
  - 마이크로서비스보다 서비스 크기가 큰 경향
  - 배포 복잡성
``` mermaid
graph TD
    Client[클라이언트] --> ESB[Enterprise Service Bus]
    
    subgraph 비즈니스 서비스
        ESB <--> Service1[고객 관리 서비스]
        ESB <--> Service2[주문 관리 서비스]
        ESB <--> Service3[인벤토리 서비스]
        ESB <--> Service4[빌링 서비스]
    end
    
    subgraph 애플리케이션 서비스
        Service1 --> App1[고객 데이터 서비스]
        Service2 --> App2[주문 처리 서비스]
        Service2 --> App3[배송 서비스]
        Service3 --> App4[재고 관리 서비스]
        Service4 --> App5[결제 처리 서비스]
    end
    
    subgraph 기반 서비스
        App1 --> DB1[(고객 DB)]
        App2 --> DB2[(주문 DB)]
        App3 --> DB2
        App4 --> DB3[(재고 DB)]
        App5 --> DB4[(결제 DB)]
        
        Registry[서비스 레지스트리]
        ESB <--> Registry
    end
```

# 클린 아키텍처 (Clean Architecture)
- **challenge** <br>
  - 시스템을 계층으로 나누고, 의존성 규칙을 통해 내부 계층이 외부 계층에 의존하지 않도록 설계하는 방식. 비즈니스 로직을 중심에 두고 인프라스트럭처, 프레임워크, UI 등의 세부사항으로부터 분리
- **pros** <br>
  - 비즈니스 로직이 외부 의존성으로부터 분리되어 테스트 용이
  - 비즈니스 로직 변경 시 외부 계층에 영향 없음
  - 특정 프레임워크에 종속되지 않음
  - 외부 계층 변경이 쉬움 (DB 변경, UI 변경 등)
- **cons** <br>
  - 아키텍처 설계에 많은 노력 필요
  - 간단한 애플리케이션에서는 과도할 수 있음
  - 새로운 개발자들의 진입 장벽 높음
  - 추상화, 인터페이스 등으로 코드량 증가
``` mermaid
graph TD
    subgraph "클린 아키텍처"
        subgraph "Entities "
            Entities[비즈니스 객체와 규칙]
        end
        
        subgraph "Use Cases"
            UseCases[애플리케이션 특화 비즈니스 규칙]
            UseCases --> Entities
        end
        
        subgraph "Interface Adapters"
            Controllers[컨트롤러]
            Presenters[프레젠터]
            Gateways[게이트웨이]
            
            Controllers --> UseCases
            Presenters --> UseCases
            Gateways --> UseCases
        end
        
        subgraph "Frameworks & Drivers"
            UI[웹, 모바일 UI]
            DB[데이터베이스]
            ExternalInterfaces[외부 인터페이스]
            Devices[기기]
            
            UI --> Controllers
            DB <--> Gateways
            ExternalInterfaces <--> Controllers
            Devices <--> Controllers
        end
    end
```

# 이벤트 기반 아키텍처 (Event-Driven Architecture)
- **challenge** <br>
  - 이벤트의 생성, 감지, 소비, 반응을 통해 구성 요소 간 통신이 이루어지는 소프트웨어 아키텍처 패턴
- **pros** <br>
  - 느슨한 결합(Loose Coupling)
  - 확장성과 유연성
  - 비동기 처리
  - 실시간 처리 가능
- **cons** <br>
  - 복잡한 이벤트 추적 및 디버깅
  - 이벤트 순서 보장의 어려움
  - 일관성 유지 도전적
  - 초기 설계 복잡성
``` mermaid
graph TD
    subgraph "Publishers"
        P1[서비스 A] -->|이벤트 발행| EB
        P2[서비스 B] -->|이벤트 발행| EB
        P3[서비스 C] -->|이벤트 발행| EB
    end
    
    EB[이벤트 버스/메시지 브로커]
    
    EB -->|주문 생성 이벤트| C1
    EB -->|결제 완료 이벤트| C2
    EB -->|배송 상태 이벤트| C3
    EB -->|모든 이벤트| C4
    
    subgraph "Subscribers"
        C1[결제 서비스]
        C2[재고 서비스]
        C3[배송 서비스] 
        C4[분석 서비스]
    end
    
    subgraph "이벤트 스토어"
        ES[Event Store/Database]
    end
    
    P1 -.->|이벤트 기록| ES
    P2 -.->|이벤트 기록| ES
    P3 -.->|이벤트 기록| ES
    
    ES -.->|이벤트 재생| C5[이벤트 재생 소비자]
```

# 트랜잭셔널 아웃박스 패턴 (Transactional Outbox Pattern)
- **challenge** <br>
  - 분산 시스템에서 데이터베이스 트랜잭션과 메시지 발행(이벤트 발행)의 원자성을 보장하기 위한 디자인 패턴
- **pros** <br>
  - 데이터베이스 변경과 메시지 저장이 동일한 트랜잭션에서 발생하므로 원자성이 보장
  - 시스템 장애가 발생해도 outbox에 저장된 메시지는 복구 후 처리 가능
  - 메시지 브로커가 일시적으로 사용 불가능해도 애플리케이션은 계속 작동 가능
  - 메시지 발행 순서를 보장
  - 실패한 메시지 발행을 쉽게 재시도 가능
- **cons** <br>
  - 추가적인 테이블과 폴링 프로세스가 필요하여 시스템이 구성 복잡화
  - 장애 상황에서 동일한 메시지가 여러 번 발행될 수 있어 멱등성 필요
  - 추가 컴포넌트(메시지 릴레이)에 대한 관리 포인트 발생
``` mermaid
graph TB
    A[애플리케이션] -->|데이터 변경 & 메시지 저장<br>단일 트랜잭션| B[(데이터베이스)]
    
    subgraph 데이터베이스
        B --> C[(비즈니스 데이터)]
        B --> D[(Outbox 테이블)]
    end
    
    E[메시지 릴레이/폴러] -->|폴링| D
    E -->|메시지 발행| F[메시지 브로커]
    E -->|완료된 메시지 처리| D
    
    F -->|메시지 전달| G[소비자 서비스]
```

# 리액티브 시스템 아키텍처 (Reactive System Architecture)
- **challenge** <br>
  - 데이터 흐름(Data Stream)과 변화 전파(Propagation of Change)를 중심으로 하는 비동기 프로그래밍 패러다임. 이벤트, 메시지, 데이터 스트림 등 변화하는 데이터에 반응하여 시스템이 동작
  - **반응성 (Responsiveness)**: 시스템이 즉시 응답
  - **탄력성 (Resilience)**: 장애 발생 시에도 시스템이 계속 동작
  - **회복성 (Elasticity)**: 부하에 따라 자동으로 확장/축소
  - **메시지 기반 (Message-Driven)**: 느슨한 결합을 위한 비동기 메시지 전달
- **pros** <br>
  - 실시간 데이터 처리에 적합
  - 높은 확장성과 성능
  - 비동기 작업 처리의 효율성
  - 이벤트 기반 아키텍처로 인한 유연성
  - 백프레셔(Backpressure) 지원으로 리소스 관리 용이
- **cons** <br>
  - 학습 곡선이 가파름
  - 디버깅이 복잡할 수 있음
  - 메모리 사용량이 증가할 수 있음
  - 코드의 복잡도가 증가할 수 있음
``` mermaid
flowchart LR
    A((Producer)) -->|Event Stream| B[Buffer/Flow Controller]
    B -->|Event Stream| C((Consumer1))
    B -->|Event Stream| D((Consumer2))
    C -->|Back Pressure Signal| B
    D -->|Back Pressure Signal| B
    B -->|Demand Control| A
``` 

# 사가 패턴 (Saga Pattern)
- **challenge** <br>
  - 분산 트랜잭션 관리를 위한 패턴으로, 각 마이크로서비스의 로컬 트랜잭션을 순차적으로 실행하고 실패 시 보상 트랜잭션을 통해 일관성을 유지
- **pros** <br>
  - 마이크로서비스 환경에서 데이터 일관성 보장
  - 장애 시 복구 메커니즘 제공
  - 높은 확장성과 유연성
- **cons** <br>
  - 구현 복잡성 증가
  - 최종 일관성만 보장(즉시 일관성 X)
  - 디버깅과 테스트의 어려움
``` mermaid
sequenceDiagram
    participant Client
    participant OrderService
    participant PaymentService
    participant InventoryService
    participant ShippingService
    participant SagaOrchestrator
    
    Client->>OrderService: 주문 생성 요청
    OrderService->>SagaOrchestrator: 주문 사가 시작
    
    Note over SagaOrchestrator: 트랜잭션 시작
    
    SagaOrchestrator->>OrderService: 주문 생성
    OrderService-->>SagaOrchestrator: 주문 생성 완료
    
    SagaOrchestrator->>PaymentService: 결제 처리
    PaymentService-->>SagaOrchestrator: 결제 성공
    
    SagaOrchestrator->>InventoryService: 재고 감소
    
    alt 재고 부족
        InventoryService-->>SagaOrchestrator: 재고 부족 오류
        SagaOrchestrator->>PaymentService: 결제 취소 (보상 트랜잭션)
        PaymentService-->>SagaOrchestrator: 결제 취소 완료
        SagaOrchestrator->>OrderService: 주문 취소 (보상 트랜잭션)
        OrderService-->>SagaOrchestrator: 주문 취소 완료
        SagaOrchestrator-->>Client: 주문 실패 응답
    else 재고 충분
        InventoryService-->>SagaOrchestrator: 재고 감소 성공
        SagaOrchestrator->>ShippingService: 배송 정보 생성
        ShippingService-->>SagaOrchestrator: 배송 정보 생성 성공
        
        Note over SagaOrchestrator: 트랜잭션 완료
        
        SagaOrchestrator-->>Client: 주문 성공 응답
    end
```

# 2단계 커밋 패턴 (Two-Phase Commit Pattern)
- **challenge** <br>
  - 분산 시스템에서 원자성을 보장하기 위한 트랜잭션 프로토콜로, 준비 단계와 커밋 단계로 구성
- **pros** <br>
  - 완전한 원자성 보장
  - 강한 일관성 제공
  - 분산 환경에서의 트랜잭션 관리
- **cons** <br>
  - 코디네이터가 단일 장애점(SPOF)
  - 블로킹 프로토콜로 성능 저하
  - 장애 복구 복잡성
``` mermaid
sequenceDiagram
    participant Client
    participant Coordinator
    participant DB1 as Database 1
    participant DB2 as Database 2
    participant DB3 as Database 3
    
    Client->>Coordinator: 트랜잭션 요청
    
    Note over Coordinator: Phase 1: Prepare
    
    Coordinator->>DB1: Prepare (트랜잭션 데이터)
    Coordinator->>DB2: Prepare (트랜잭션 데이터)
    Coordinator->>DB3: Prepare (트랜잭션 데이터)
    
    DB1-->>Coordinator: Ready
    DB2-->>Coordinator: Ready
    DB3-->>Coordinator: Ready
    
    Note over Coordinator: Phase 2: Commit
    
    alt All resources ready
        Coordinator->>DB1: Commit
        Coordinator->>DB2: Commit
        Coordinator->>DB3: Commit
        
        DB1-->>Coordinator: Committed
        DB2-->>Coordinator: Committed
        DB3-->>Coordinator: Committed
        
        Coordinator-->>Client: 트랜잭션 성공
    else Any resource not ready
        Coordinator->>DB1: Abort
        Coordinator->>DB2: Abort
        Coordinator->>DB3: Abort
        
        DB1-->>Coordinator: Aborted
        DB2-->>Coordinator: Aborted
        DB3-->>Coordinator: Aborted
        
        Coordinator-->>Client: 트랜잭션 실패
    end
    
    Note over Coordinator, DB3: 모든 참여자는 트랜잭션 로그 유지
```
