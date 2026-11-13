import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Folder from './Folder';

const items = [{ title: 'Brand guidelines' }, { title: 'Launch plan' }, { title: 'Your pages' }];

let root = null;
let setter = null;
let wanted = false;

function BuildFolder() {
  const [open, setOpen] = useState(wanted);
  useEffect(() => {
    setter = setOpen;
    setOpen(wanted);
    return () => { setter = null; };
  }, []);
  return (
    <Folder
      label="Your website"
      items={items}
      open={open}
      onOpenChange={setOpen}
      closeOnOutsideClick={false}
    />
  );
}

window.BuildFolder = {
  mount(el) {
    if (root || !el) return;
    root = createRoot(el);
    root.render(<BuildFolder />);
  },
  setOpen(value) {
    wanted = value;
    if (setter) setter(value);
  }
};
