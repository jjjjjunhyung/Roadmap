### 1. ci/cd
###### challenge <br>
 Multi region, multi project로 구성되어 있는 eks 서비스들을 수동으로 sync 하기 어려움 <br>
 배포 과정을 일관화된 방법으로 체계적으로 관리하고 자동화할 필요성 <br>
###### solution <br>
 CircleCi를 통한 애플리케이션 빌드 후 ArgoCD를 통한 k8s 배포
###### pros & cons <br>
  - pros
    - 배포 과정을 조금 더 체계적으로 관리하고 단일화하여 human error 방지
    - 배포 환경이 버전별로 관리되기 떄문에 배포 상태를 쉽게 파악할 수 있어 안정적으로 production 환경에 배포 가능
    - 원하는 배포 상태에 맞추어 자가 치유 및 이상 탐지 가능
  - cons
    - k8s 환경에서만 ArgoCD를 사용할 수 있음
    - git 서비스의 장애를 고려해야 함

### 2. Auto Scaling
###### challenge <br>
 서비스 부하가 불규칙한 상황에서 고정된 개수의 instance를 운영하는 것은 비효율적인 상황 <br>
 부하가 집중되는 상황에서는 인스턴스 개수를 늘리고, 그 외의 상황에서는 최소화하는 방식으로 유연하게 운영할 필요성 <br>
###### solution <br>
 Karpenter는 AWS EKS 환경에서 동작하는 오픈소스 자동 스케일링 솔루션으로, 빠른 노드 프로비저닝과 효율적인 리소스 활용을 제공 <br>
- 빠른 노드 생성: 신속하게 노드를 증설하여, 갑작스러운 트래픽 증가에도 빠르게 대응할 수 있음
- 커스텀 가능한 스케일링 정책: 특정 워크로드(예: CPU 집약, 메모리 집약)에 맞춰 태그나 라벨을 기반으로 노드를 생성 가능
- 프로비저닝 효율성: 필요 리소스에 정확히 맞춰 노드를 생성하므로, 오버프로비저닝을 줄이고 비용을 절감할 수 있음
- 프라이싱 옵션 연동: AWS 스팟 인스턴스 등을 활용하여, 동일한 성능을 보다 저렴한 비용으로 운영 가능.

### 3. Deployment Strategy
###### challenge <br>
 Rolling update 사용시 안정적이고 높은 서비스 가용성을 유지할 수 있지만 배포시간이 길고 롤백이 어려움 <br>
###### options <br>
  - blue/green <br>
  - canary <br>
  - A/B testing <br>
