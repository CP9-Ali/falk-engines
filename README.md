# FALK Engines

تنفيذ TypeScript لتصميم محركات FALK.

## المبادئ المُطبَّقة
- §1.1 لا اختراع قيم عند نقص/تعارض.
- §5.4 منع تسرب المستقبل عبر LookaheadGuard.
- §7 دورة حياة صارمة (11 حالة + 7 تنفيذ).
- §10 سجل تدقيق بسلسلة hash.
- §16 كل القرارات المفتوحة تُمرَّر صراحة.

## التشغيل
```bash
npm install
npm run build
npm test
npm run demo