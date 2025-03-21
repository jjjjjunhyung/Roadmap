### 1. Soft Delete
###### challenge <br>
 로깅 및 디버깅을 위해 특정 테이블에서의 soft delete 기능 필요 <br>
 특정 칼럼의 값과 관련하여 삭제되지 않은 entity들의 uniqueness는 보장되어야 하되, 삭제된 entity들의 duplicate은 허용되어야 하는 상황 <br>
 Mysql은 Postgre SQL과 다르게 partial index를 지원하지 않음 <br>
###### solution <br>
 기존에 존재하던 name 칼럼과 notArchived(1 or null) 칼럼을 새롭게 추가하여 unique constraint 설정

### 2. Entity race condition
###### challenge <br>
  - Concurrency Issue <br>
    여러 트랜잭션이 동일한 데이터를 동시에 업데이트하려고 할 때, 데이터 불일치가 발생할 수 있음
  - Locking <br>
     Concurrency Issue를 해결하기 위해 Locking 메커니즘을 사용할 때, 충돌 혹은 교착상태가 발생할 수 있음
###### solution <br>
 - JPA의 @Version 데코레이터(Long, Integer, Short, Timestamp)를 사용하여 Optimistic Lock 방식으로 엔티티의 버전을 관리
   - Lock 종류
     - Read: 트랜잭션 동안 엔티티를 읽기 가능 & 쓰기 불가능 상태로 lock하여 다른 트랜잭션이 엔티티를 수정할 수 없도록 함
     - Write: 트랜잭션 동안 엔티티를 읽기 불가능 & 쓰기 불가능 상태로 lock하여 다른 트랜잭션이 엔티티를 수정할 수 없도록 함
     - Force Increment: 트랜잭션 동안 엔티티를 읽기 불가능 & 쓰기 불가능 상태로 lock하여 다른 트랜잭션이 엔티티를 수정할 수 없도록 함 + 트랜잭션이 끝날 때 엔티티의 버전을 강제로 증가
   - Optimistic Lock
     - Default(@Version)
     - LockMode.OPTIMISTIC
     - LockMode.OPTIMISTIC_FORCE_INCREMENT
   - Pessimistic Lock (DB Lock + Query)
     - LockModeType.PESSIMISTIC_READ
     - LockModeType.PESSIMISTIC_WRITE
     - LockModeType.PESSIMISTIC_FORCE_INCREMENT
 - TransactionSynchronizationManager, TransactionSynchronization을 사용하여 함수 override
   - 트랜잭션이 시작될 때 TransactionSynchronization을 등록
   - 트랜잭션 커밋 전·후에 수행할 작업을 beforeCommit, afterCommit 등의 메서드에 정의
   - 복잡한 트랜잭션 흐름에서 특정 작업을 보장할 수 있음

### 3. JVM GC
###### challenge <br>
 JVM을 사용하는 프로젝트의 별도 설정을 해주지 않으면 사용하는 컴퓨팅 자원의 사이즈에 따라 GC 알고리즘이 채택 <br>
 Production 환경에서 관리자가 의도치 않게 어플리케이션이 원시적인 GC 알고리즘을 사용할 수 있음
###### solution <br>
  - G1 GC
    - 하드웨어가 발전함에 따라 큰 메모리(RAM) 공간을 가지고 있는 멀티 프로세서 시스템에서 빠른 처리 속도를 지원한다.
    - 최소 2 cpu 및 4GB memory 인 환경에서 권장되며 Java 9+부터는 default GC로 채택
    - GC 동안 애플리케이션의 작업이 예측 가능한 짧은 시간동안 멈춤
  - Serial GC
    - 가장 간단한 GC 구현체이며 싱글 스레드로 동작
    - GC가 실행되는 동안 애플리케이션의 모든 작업이 멈춤
  - Parallel GC / CMS GC
    - 다수의 스레드를 사용하며, GC 동작 시 최소한의 pause 타임을 가지도록 설계
    - GC 동안 애플리케이션의 작업이 멈추지만, 멀티 스레드로 인해 처리 속도가 빠름
  - Z GC
    - Java11부터 실험적으로 소개되어 Java15에 릴리즈된 확장성 있는 GC
    - GC 동안 애플리케이션의 작업이 멈추는 시간을 10ms 아래로 가져가는 것을 목표

### 4. JPA N+1
###### challenge <br>
###### solution <br>

### 5. JPA Cache
###### challenge <br>
###### solution <br>
