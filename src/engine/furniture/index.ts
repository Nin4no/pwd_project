/**
 * 가구 설계도 조립 모듈 엔트리포인트 — 모든 모듈 빌더를 등록하고 assemble을 재export한다.
 */
import './modules/bedframe';
import './modules/seat';
import './modules/board';
import './modules/rack';
import './modules/lamp';
import './modules/mirror';
import './modules/appliance';

export {
  assemble, countFloating, hasModule, registerModule,
  boxPrim, cylPrim, handle, r3,
  type AssembleResult, type BuildCtx, type BuildResult, type ModuleBuilder,
} from './assemble';
export {
  boxCenter, boxD, boxH, boxW,
  type Anchor, type Blueprint, type Box3, type MaterialKey, type ModuleSpec, type ModuleType, type ParamValue,
} from './blueprint';
export { MATERIALS, mat } from './materials';
