# Spring
## IoC (Inversion of Control) & Spring Bean
## AOP (Aspect-Oriented Programming)
## Spring MVC
## Spring Security
## Test
## Web Server & Web Aplication Server & API Server
## Data Acess & ORM
## Spring Webflux

# JVM
## JVM Structure & Components
## JVM Memory
## JVM JIT (Just-In-Time) Compiler
## JVM Thread
## JVM Garbage Collection
- **challenge** <br>
  - JVM을 사용하는 프로젝트의 별도 설정을 해주지 않으면 사용하는 컴퓨팅 자원의 사이즈에 따라 GC 알고리즘이 채택 <br>
  - Production 환경에서 관리자가 의도치 않게 어플리케이션이 원시적인 GC 알고리즘을 사용할 수 있음
- **option** <br>
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
