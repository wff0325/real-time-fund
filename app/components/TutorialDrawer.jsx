import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export default function TutorialDrawer({ open, onOpenChange }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="glass" style={{ height: '95vh' }}>
        <DrawerHeader>
          <DrawerTitle>使用帮助</DrawerTitle>
        </DrawerHeader>
        <div style={{ flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
          <iframe
            src="https://jcle26f8aw.feishu.cn/docx/Qis6d6ntFoaTOZxPVlUckVIpn8c"
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="使用帮助"
            frameBorder={0}
            allowFullScreen
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
