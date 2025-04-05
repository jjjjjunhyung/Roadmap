# Apache Kafka
- **challenge** <br>
  - 높은 처리량, 내구성, 확장성을 갖춘 발행-구독(pub-sub) 메시징 시스템으로 설계됨
- **pros** <br>
  - 극도로 높은 처리량 (초당 수백만 개의 메시지)
  - 확장성이 뛰어나며 분산 시스템으로 설계됨
  - 메시지 영속성과 내구성 (디스크에 데이터 보존)
  - 스트림 처리 기능 (Kafka Streams, KSQL)
  - 장기간 데이터 보존 가능 (시간 또는 용량 기반)
- **cons** <br>
  - 설정과 관리가 복잡함
  - 소규모 응용 프로그램에는 과도한 솔루션일 수 있음
  - 많은 기본 기능에 추가 구성이 필요함
  - 무거운 리소스 소비 (JVM 기반)
```mermaid
flowchart LR
    subgraph "Producers"
        P1["Producer 1"]
        P2["Producer 2"]
    end
    
    P1 -->|메시지 발행| T1
    P2 -->|메시지 발행| T2
    
    subgraph "Kafka 브로커 클러스터"
        subgraph "토픽과 파티션"
            T1["Topic 1"]
            T1P0["Partition 0"]
            T1P1["Partition 1"]
            T1 --- T1P0
            T1 --- T1P1
            
            T2["Topic 2"]
            T2P0["Partition 0"]
            T2P1["Partition 1"]
            T2 --- T2P0
            T2 --- T2P1
        end
        
        ZK["ZooKeeper<br>(메타데이터 관리)"]
    end
    
    T1P0 -->|메시지 소비| CG1
    T1P1 -->|메시지 소비| CG1
    T2P0 -->|메시지 소비| CG2
    T2P1 -->|메시지 소비| CG2
    
    subgraph "Consumers"
        CG1["Consumer Group 1"]
        CG2["Consumer Group 2"]
        
        CG1C1["Consumer 1-1"]
        CG1C2["Consumer 1-2"]
        CG2C1["Consumer 2-1"]
        
        CG1 --- CG1C1
        CG1 --- CG1C2
        CG2 --- CG2C1
    end
```

# RabbitMQ
- **challenge** <br>
  - AMQP(Advanced Message Queuing Protocol)를 구현한 오픈 소스 메시지 브로커
- **pros** <br>
  - 유연한 라우팅 패턴 (Direct, Topic, Fanout, Headers)
  - 높은 신뢰성과 메시지 전달 보장
  - 클러스터링 및 고가용성 기능
  - 관리 UI가 내장되어 있어 운영 편의성 높음
  - 다양한 프로그래밍 언어를 위한 클라이언트 라이브러리 제공
- **cons** <br>
  - Kafka보다 낮은 처리량
  - 대용량 메시지 처리시 성능 저하 가능성
  - 기본적으로 디스크에 영구 저장하여 I/O 병목 발생 가능
  - 복잡한 설정이 필요한 경우 학습 곡선 존재
```mermaid
flowchart LR
    subgraph "Producers"
        P1["Producer 1"]
        P2["Producer 2"]
    end
    
    P1 -->|메시지 발행| E1
    P2 -->|메시지 발행| E2
    
    subgraph "RabbitMQ 브로커"
        subgraph "Exchange"
            E1["Exchange 1<br>(Direct)"]
            E2["Exchange 2<br>(Fanout)"]
        end
        
        subgraph "Queue"
            Q1["Queue 1"]
            Q2["Queue 2"]
            Q3["Queue 3"]
        end
        
        E1 -->|라우팅 키| Q1
        E1 -->|라우팅 키| Q2
        E2 -->|브로드캐스트| Q2
        E2 -->|브로드캐스트| Q3
    end
    
    Q1 -->|메시지 소비| C1
    Q2 -->|메시지 소비| C2
    Q3 -->|메시지 소비| C3
    
    subgraph "Consumers"
        C1["Consumer 1"]
        C2["Consumer 2"]
        C3["Consumer 3"]
    end
```

# Apache ActiveMQ
- **challenge** <br>
  - JMS(Java Message Service) API를 구현한 오픈 소스 메시지 브로커
- **pros** <br>
  - JMS 표준 완벽 지원 (Java 기반 애플리케이션과 호환성 높음)
  - 다양한 통신 프로토콜 지원
  - 트랜잭션 처리 지원
  - 영구 메시지 저장소 제공
  - 클러스터링과 마스터-슬레이브 복제 지원
- **cons** <br>
  - Kafka나 RabbitMQ보다 낮은 성능
  - 큰 부하에서 안정성 이슈 발생 가능
  - 설정 및 관리가 복잡할 수 있음
  - 최신 버전의 ActiveMQ Artemis로 이전하는 추세
```mermaid
flowchart LR
    subgraph "Producers"
        P1["Producer 1<br>(Queue 송신자)"]
        P2["Producer 2<br>(Topic 발행자)"]
    end
    
    P1 -->|Point-to-Point 메시지| Q
    P2 -->|Publish-Subscribe 메시지| T
    
    subgraph "ActiveMQ 브로커"
        subgraph "Destinations"
            Q["Queue<br>(Point-to-Point)"]
            T["Topic<br>(Publish-Subscribe)"]
        end
        
        Store["Message Store<br>(KahaDB)"]
        Q -.->|지속성| Store
        T -.->|지속성| Store
    end
    
    Q -->|단일 소비자에게 전달| C1
    T -->|모든 구독자에게 전달| S1
    T -->|모든 구독자에게 전달| S2
    
    subgraph "Consumers"
        C1["Queue Consumer"]
        
        subgraph "Topic Subscribers"
            S1["Subscriber 1"]
            S2["Subscriber 2"]
        end
    end
```

# Redis Streams
- **challenge** <br>
  - Redis 5.0에서 도입된 데이터 구조로, 로그 또는 시계열 데이터를 위해 스트리밍 기능을 제공
- **pros** <br>
  - 높은 성능과 낮은 지연 시간 (메모리 내 작동)
  - 간단한 설정 (Redis를 이미 사용하는 경우 추가 인프라 불필요)
  - 소비자 그룹을 통한 메시지 분배 기능
  - 메시지 ID를 통한 임의 접근 용이성
  - 경량 솔루션 (소규모 응용 프로그램에 적합)
- **cons** <br>
  - 기본적으로 메모리에 제한됨 (RDB/AOF로 지속성 확보 가능)
  - Kafka나 RabbitMQ에 비해 고급 라우팅 기능 부족
  - 대규모 분산 시스템에서의 확장성 제한
  - 비동기식 복제로 인한 잠재적 데이터 손실 위험
```mermaid
flowchart LR
    subgraph "Producers"
        P1["Producer 1"]
        P2["Producer 2"]
    end
    
    P1 -->|XADD| S1
    P2 -->|XADD| S2
    
    subgraph "Redis Streams"
        S1["Stream 1<br>메시지들: {ID: 시간-시퀀스, 필드: 값}"]
        S2["Stream 2<br>메시지들: {ID: 시간-시퀀스, 필드: 값}"]
    end
    
    S1 -->|XREADGROUP| CG1
    S1 -->|XREADGROUP| CG2
    S2 -->|XREADGROUP| CG3
    
    subgraph "Consumer Groups"
        CG1["Consumer Group 1"]
        CG2["Consumer Group 2"]
        CG3["Consumer Group 3"]
    end
    
    CG1 -->|메시지 분배| C1
    CG1 -->|메시지 분배| C2
    CG2 -->|메시지 분배| C3
    CG3 -->|메시지 분배| C4
    
    subgraph "Consumers"
        C1["Consumer 1"]
        C2["Consumer 2"]
        C3["Consumer 3"]
        C4["Consumer 4"]
    end
```
