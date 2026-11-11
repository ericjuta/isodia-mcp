import { at, flat, LEFT, on, Pen, type Pt, RIGHT, ring, TOP } from './pen';

/**
 * The bundled icons. Each one is a plain noun drawn as a paper model; `keywords` are the other
 * names people search for it by. The first 37 ids are those of the original Isoflow icon set, so
 * files made with it open with our drawing of the same thing.
 */
export interface IconDefinition {
  id: string;
  name: string;
  keywords: string;
  draw(pen: Pen): void;
}

/** Plane coordinates of a point given as right and up on screen. */
const spot = (right: number, up: number): [number, number] => [(right + up) * Math.SQRT1_2, (up - right) * Math.SQRT1_2];

/** A ring standing upright in the plane y = `y`, around (x, z). */
const uprightRing = (x: number, y: number, z: number, r: number, from = 0, to = 360, steps = 28): Pt[] =>
  Array.from({ length: steps + 1 }, (_, step) => {
    const angle = ((from + ((to - from) * step) / steps) * Math.PI) / 180;
    return at(x + r * Math.cos(angle), y, z + r * Math.sin(angle));
  });

const ICONS: IconDefinition[] = [
  {
    id: 'block',
    name: 'Block',
    keywords: 'generic thing component box default',
    draw: (p) => void p.block(0.76, 0.76, 0.36)
  },
  {
    id: 'cube',
    name: 'Cube',
    keywords: 'box object 3d generic',
    draw: (p) => {
      const f = p.block(0.62, 0.62, 0.62);
      for (const face of [f.left, f.right]) p.line(on(face, [[0.5, 0.08], [0.5, 0.92]]), { soft: true });
      p.line(on(f.top, [[0.08, 0.5], [0.92, 0.5]]), { soft: true });
    }
  },
  {
    id: 'server',
    name: 'Server',
    keywords: 'host machine backend compute node rack',
    draw: (p) => {
      const f = p.block(0.5, 0.56, 0.78);
      for (const v of [0.78, 0.53, 0.28]) {
        p.line(on(f.right, [[0.14, v], [0.62, v]]), { width: 3 });
        p.dot(f.right(0.82, v), 3);
      }
      for (const v of [0.66, 0.41, 0.16]) p.line(on(f.left, [[0.1, v], [0.9, v]]), { soft: true });
    }
  },
  {
    id: 'storage',
    name: 'Storage',
    keywords: 'disk drive volume nas san ebs persistent',
    draw: (p) => {
      for (const z of [0, 0.24, 0.48]) {
        const f = p.block(0.74, 0.74, 0.18, z);
        p.dot(f.right(0.84, 0.5), 2.8);
        p.line(on(f.right, [[0.12, 0.5], [0.6, 0.5]]), { soft: true });
      }
    }
  },
  {
    id: 'cache',
    name: 'Cache',
    keywords: 'redis memcached memory fast in-memory',
    draw: (p) => {
      const t = p.tub(0, 0, 0.42, 0.42, 0, 0.26);
      p.mark(on(t.top, [[0.12, 0.78], [-0.34, -0.06], [-0.02, -0.06], [-0.16, -0.78], [0.34, 0.1], [0.02, 0.1]]));
    }
  },
  {
    id: 'cardterminal',
    name: 'Card terminal',
    keywords: 'pos point of sale reader payment checkout',
    draw: (p) => {
      const screen = p.box(-0.18, 0.06, 0.18, 0.16, 0.2, 0.52);
      p.line(on(screen.right, [[0.14, 0.2], [0.86, 0.2], [0.86, 0.82], [0.14, 0.82]]), { soft: true, close: true });
      const body = p.box(-0.22, -0.3, 0.22, 0.06, 0, 0.2);
      for (const u of [0.25, 0.5, 0.75]) for (const v of [0.3, 0.65]) p.dot(body.top(u, v), 2.4);
    }
  },
  {
    id: 'cloud',
    name: 'Cloud',
    keywords: 'internet saas provider aws azure gcp hosting external',
    draw: (p) => {
      const [lx, ly] = spot(-0.27, -0.02);
      const [rx, ry] = spot(0.27, 0.02);
      const [cx, cy] = spot(0, 0.04);
      p.ball(lx, ly, 0.22, 0.19);
      p.ball(rx, ry, 0.24, 0.21);
      p.ball(cx, cy, 0.36, 0.27);
    }
  },
  {
    id: 'cronjob',
    name: 'Cron job',
    keywords: 'schedule timer clock periodic batch job',
    draw: (p) => {
      const t = p.tub(0, 0, 0.42, 0.42, 0, 0.22);
      p.line(on(t.top, [[0, 0.62], [0, 0], [0.46, 0]]), { width: 3.5 });
      p.dot(t.top(0, 0), 3.5);
      for (const [u, v] of [[0, 0.86], [0.86, 0], [0, -0.86], [-0.86, 0]] as const) p.dot(t.top(u, v), 2.2);
    }
  },
  {
    id: 'desktop',
    name: 'Desktop',
    keywords: 'computer monitor workstation pc screen client',
    draw: (p) => {
      p.block(0.38, 0.26, 0.04, 0, 0, 0.1);
      p.block(0.08, 0.06, 0.24, 0.04, 0, 0.16);
      const screen = p.box(-0.4, 0.06, 0.4, 0.14, 0.24, 0.72);
      p.line(on(screen.right, [[0.07, 0.12], [0.93, 0.12], [0.93, 0.88], [0.07, 0.88]]), { soft: true, close: true });
    }
  },
  {
    id: 'diamond',
    name: 'Diamond',
    keywords: 'gem decision choice premium value',
    draw: (p) => {
      p.pyramid(-0.32, -0.32, 0.32, 0.32, 0.02, 0.3, true);
      p.pyramid(-0.32, -0.32, 0.32, 0.32, 0.3, 0.58);
    }
  },
  {
    id: 'dns',
    name: 'DNS',
    keywords: 'domain name resolver route53 signpost directory lookup',
    draw: (p) => {
      const upper = p.box(0.04, 0.02, 0.44, 0.08, 0.5, 0.68);
      p.line(on(upper.right, [[0.15, 0.5], [0.75, 0.5]]), { soft: true });
      p.block(0.07, 0.07, 0.76, 0, 0, 0.05);
      const lower = p.box(-0.42, 0.02, -0.04, 0.08, 0.26, 0.44);
      p.line(on(lower.right, [[0.25, 0.5], [0.85, 0.5]]), { soft: true });
      p.block(0.3, 0.3, 0.03);
    }
  },
  {
    id: 'document',
    name: 'Document',
    keywords: 'file page doc spec text pdf report',
    draw: (p) => {
      const f = p.box(-0.3, 0, 0.3, 0.06, 0, 0.72);
      for (const v of [0.78, 0.64, 0.5, 0.36, 0.22]) p.line(on(f.right, [[0.16, v], [v === 0.22 ? 0.56 : 0.84, v]]), { soft: true });
      p.shape(on(f.right, [[0.72, 1], [1, 1], [1, 0.86]]), LEFT);
    }
  },
  {
    id: 'firewall',
    name: 'Firewall',
    keywords: 'waf security filter wall perimeter network policy',
    draw: (p) => {
      const f = p.box(-0.44, -0.1, 0.44, 0.12, 0, 0.56);
      for (const v of [1 / 3, 2 / 3]) p.line(on(f.right, [[0, v], [1, v]]));
      for (const [u, v0, v1] of [
        [0.25, 0, 1 / 3], [0.5, 0, 1 / 3], [0.75, 0, 1 / 3],
        [0.125, 1 / 3, 2 / 3], [0.375, 1 / 3, 2 / 3], [0.625, 1 / 3, 2 / 3], [0.875, 1 / 3, 2 / 3],
        [0.25, 2 / 3, 1], [0.5, 2 / 3, 1], [0.75, 2 / 3, 1]
      ] as const) {
        p.line(on(f.right, [[u, v0], [u, v1]]));
      }
    }
  },
  {
    id: 'function-module',
    name: 'Function',
    keywords: 'lambda serverless cloud function faas handler code',
    draw: (p) => {
      const f = p.block(0.6, 0.6, 0.6);
      p.line(on(f.right, [[0.3, 0.84], [0.42, 0.84], [0.74, 0.16]]), { width: 4 });
      p.line(on(f.right, [[0.54, 0.47], [0.3, 0.16]]), { width: 4 });
    }
  },
  {
    id: 'image',
    name: 'Image',
    keywords: 'picture photo media asset jpeg png',
    draw: (p) => {
      const f = p.box(-0.34, 0, 0.34, 0.06, 0, 0.58);
      p.line(on(f.right, [[0.08, 0.1], [0.92, 0.1], [0.92, 0.9], [0.08, 0.9]]), { soft: true, close: true });
      p.mark(on(f.right, [[0.12, 0.14], [0.38, 0.56], [0.52, 0.38], [0.68, 0.62], [0.88, 0.14]]));
      p.dot(f.right(0.3, 0.74), 4);
    }
  },
  {
    id: 'laptop',
    name: 'Laptop',
    keywords: 'notebook computer client developer device',
    draw: (p) => {
      const screen = p.box(-0.4, 0.14, 0.4, 0.2, 0.06, 0.5);
      p.line(on(screen.right, [[0.06, 0.1], [0.94, 0.1], [0.94, 0.9], [0.06, 0.9]]), { soft: true, close: true });
      const base = p.box(-0.4, -0.34, 0.4, 0.14, 0, 0.06);
      p.line(on(base.top, [[0.1, 0.25], [0.9, 0.25], [0.9, 0.85], [0.1, 0.85]]), { soft: true, close: true });
    }
  },
  {
    id: 'loadbalancer',
    name: 'Load balancer',
    keywords: 'lb alb elb nlb proxy balancer traffic distribute ingress',
    draw: (p) => {
      const f = p.block(0.76, 0.76, 0.26);
      const from = f.top(0.16, 0.16);
      for (const end of [f.top(0.86, 0.22), f.top(0.8, 0.8), f.top(0.22, 0.86)]) {
        p.line([from, end], { width: 3 });
        p.dot(end, 3.4);
      }
      p.dot(from, 4.2);
    }
  },
  {
    id: 'lock',
    name: 'Lock',
    keywords: 'security auth secure private padlock encryption',
    draw: (p) => {
      p.band([at(-0.15, 0, 0.42), ...uprightRing(0, 0, 0.42, 0.15, 180, 0, 16).slice(1), at(0.15, 0, 0.42)], 9);
      const f = p.block(0.5, 0.36, 0.42);
      p.dot(f.right(0.5, 0.58), 4.5);
      p.mark(on(f.right, [[0.46, 0.56], [0.54, 0.56], [0.57, 0.24], [0.43, 0.24]]));
    }
  },
  {
    id: 'mail',
    name: 'Mail',
    keywords: 'email message smtp notification envelope inbox',
    draw: (p) => {
      const f = p.box(-0.38, 0, 0.38, 0.06, 0, 0.5);
      p.line(on(f.right, [[0.02, 0.97], [0.5, 0.42], [0.98, 0.97]]));
    }
  },
  {
    id: 'mailmultiple',
    name: 'Mail, several',
    keywords: 'emails newsletter batch messages broadcast',
    draw: (p) => {
      const back = p.box(-0.26, 0.2, 0.44, 0.26, 0.12, 0.56);
      p.line(on(back.right, [[0.02, 0.97], [0.5, 0.42], [0.98, 0.97]]), { soft: true });
      const front = p.box(-0.42, -0.06, 0.28, 0, 0, 0.44);
      p.line(on(front.right, [[0.02, 0.97], [0.5, 0.42], [0.98, 0.97]]));
    }
  },
  {
    id: 'mobiledevice',
    name: 'Mobile device',
    keywords: 'phone smartphone app ios android tablet client',
    draw: (p) => {
      const f = p.box(-0.17, 0, 0.17, 0.08, 0, 0.66);
      p.line(on(f.right, [[0.12, 0.14], [0.88, 0.14], [0.88, 0.88], [0.12, 0.88]]), { soft: true, close: true });
      p.dot(f.right(0.5, 0.07), 2.4);
    }
  },
  {
    id: 'office',
    name: 'Office',
    keywords: 'building company headquarters business site organisation',
    draw: (p) => {
      const f = p.block(0.56, 0.56, 0.76);
      for (const u of [0.22, 0.5, 0.78]) {
        for (const v of [0.18, 0.4, 0.62, 0.84]) {
          p.mark(on(f.right, [[u - 0.08, v - 0.06], [u + 0.08, v - 0.06], [u + 0.08, v + 0.06], [u - 0.08, v + 0.06]]));
        }
      }
      for (const v of [0.29, 0.51, 0.73]) p.line(on(f.left, [[0.12, v], [0.88, v]]), { soft: true });
    }
  },
  {
    id: 'package-module',
    name: 'Package',
    keywords: 'module library npm bundle artifact dependency parcel',
    draw: (p) => {
      const f = p.block(0.64, 0.64, 0.5);
      p.line([...on(f.right, [[0.5, 0], [0.5, 1]]), ...on(f.top, [[0.5, 0], [0.5, 1]])], { width: 4 });
      p.line(on(f.left, [[0.5, 0.62], [0.5, 1]]), { soft: true });
    }
  },
  {
    id: 'paymentcard',
    name: 'Payment card',
    keywords: 'credit card debit stripe billing payment',
    draw: (p) => {
      const f = p.box(-0.36, 0, 0.36, 0.04, 0, 0.48);
      p.mark(on(f.right, [[0, 0.66], [1, 0.66], [1, 0.8], [0, 0.8]]));
      p.line(on(f.right, [[0.12, 0.22], [0.3, 0.22], [0.3, 0.42], [0.12, 0.42]]), { close: true, soft: true });
    }
  },
  {
    id: 'plane',
    name: 'Plane',
    keywords: 'flight travel aircraft airport paper plane send',
    draw: (p) => {
      const nose = at(0.02, -0.48, 0.18);
      const tail = at(0.02, 0.3, 0.3);
      const keel = at(0.02, 0.3, 0.12);
      p.shape([nose, at(0.44, 0.38, 0.3), tail], TOP);
      p.shape([nose, tail, keel], RIGHT);
      p.shape([nose, at(-0.42, 0.42, 0.3), tail], TOP);
    }
  },
  {
    id: 'printer',
    name: 'Printer',
    keywords: 'print output paper device',
    draw: (p) => {
      const paper = p.box(-0.22, 0.04, 0.22, 0.12, 0.3, 0.56);
      p.line(on(paper.right, [[0.2, 0.55], [0.8, 0.55]]), { soft: true });
      const f = p.block(0.72, 0.56, 0.32);
      p.line(on(f.right, [[0.2, 0.6], [0.8, 0.6]]), { width: 4 });
      p.dot(f.right(0.88, 0.3), 2.6);
    }
  },
  {
    id: 'pyramid',
    name: 'Pyramid',
    keywords: 'hierarchy tier stack layers triangle',
    draw: (p) => void p.pyramid(-0.4, -0.4, 0.4, 0.4, 0, 0.7)
  },
  {
    id: 'queue',
    name: 'Queue',
    keywords: 'kafka sqs rabbitmq pubsub topic message broker bus stream fifo',
    draw: (p) => {
      for (const cx of [0.3, 0, -0.3]) p.block(0.2, 0.6, 0.44, 0, cx);
    }
  },
  {
    id: 'router',
    name: 'Router',
    keywords: 'network switch routing gateway nat vpc',
    draw: (p) => {
      const t = p.tub(0, 0, 0.42, 0.42, 0, 0.24);
      p.line(on(t.top, [[-0.58, 0], [0.58, 0]]), { width: 3 });
      p.line(on(t.top, [[0, -0.58], [0, 0.58]]), { width: 3 });
      for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        p.mark(on(t.top, [[u * 0.8, v * 0.8], [u * 0.56 - v * 0.17, v * 0.56 + u * 0.17], [u * 0.56 + v * 0.17, v * 0.56 - u * 0.17]]));
      }
    }
  },
  {
    id: 'speech',
    name: 'Speech',
    keywords: 'chat message comment conversation talk bot support',
    draw: (p) => {
      p.shape([at(-0.24, 0, 0.22), at(-0.06, 0, 0.22), at(-0.3, 0, 0.04)], RIGHT);
      const f = p.box(-0.38, 0, 0.38, 0.06, 0.2, 0.64);
      for (const u of [0.3, 0.5, 0.7]) p.dot(f.right(u, 0.5), 3.6);
    }
  },
  {
    id: 'sphere',
    name: 'Sphere',
    keywords: 'ball orb world generic',
    draw: (p) => void p.ball(0, 0, 0.36, 0.34)
  },
  {
    id: 'switch-module',
    name: 'Switch',
    keywords: 'network switch ethernet ports lan hub',
    draw: (p) => {
      const f = p.block(0.8, 0.8, 0.22);
      for (let i = 0; i < 5; i++) {
        const u = 0.12 + i * 0.17;
        p.mark(on(f.right, [[u, 0.3], [u + 0.1, 0.3], [u + 0.1, 0.7], [u, 0.7]]));
      }
      p.line(on(f.top, [[0.22, 0.36], [0.78, 0.36]]), { width: 3 });
      p.mark(on(f.top, [[0.86, 0.36], [0.72, 0.28], [0.72, 0.44]]));
      p.line(on(f.top, [[0.78, 0.64], [0.22, 0.64]]), { width: 3 });
      p.mark(on(f.top, [[0.14, 0.64], [0.28, 0.56], [0.28, 0.72]]));
    }
  },
  {
    id: 'tower',
    name: 'Tower',
    keywords: 'antenna radio cell broadcast transmitter wireless signal',
    draw: (p) => {
      p.pyramid(-0.3, -0.3, 0.3, 0.3, 0, 0.78);
      p.line([at(-0.19, -0.19, 0.3), at(0.19, -0.19, 0.3)], { soft: true });
      p.line([at(-0.12, -0.12, 0.5), at(0.12, -0.12, 0.5)], { soft: true });
      const [x, y] = at(0, 0, 0.78);
      for (const side of [1, -1]) {
        for (const reach of [12, 20]) {
          p.line([[x + side * reach * 0.7, y - reach * 0.7], [x + side * reach, y], [x + side * reach * 0.7, y + reach * 0.7]], { width: 2.5 });
        }
      }
    }
  },
  {
    id: 'truck',
    name: 'Truck',
    keywords: 'delivery shipping logistics transport fleet vehicle',
    draw: (p) => {
      p.box(-0.04, -0.22, 0.46, 0.22, 0.08, 0.54);
      const cab = p.box(-0.42, -0.22, -0.06, 0.22, 0.08, 0.38);
      p.line(on(cab.left, [[0.16, 0.55], [0.84, 0.55], [0.84, 0.88], [0.16, 0.88]]), { soft: true, close: true });
      for (const x of [-0.26, 0.3]) p.dot(at(x, -0.22, 0.1), 7);
    }
  },
  {
    id: 'truck-2',
    name: 'Flatbed truck',
    keywords: 'lorry cargo transport freight vehicle',
    draw: (p) => {
      p.box(-0.42, -0.22, 0.46, 0.22, 0.08, 0.16);
      p.box(0.02, -0.16, 0.4, 0.16, 0.16, 0.4);
      const cab = p.box(-0.42, -0.22, -0.12, 0.22, 0.16, 0.42);
      p.line(on(cab.left, [[0.16, 0.5], [0.84, 0.5], [0.84, 0.86], [0.16, 0.86]]), { soft: true, close: true });
      for (const x of [-0.27, 0.32]) p.dot(at(x, -0.22, 0.1), 7);
    }
  },
  {
    id: 'user',
    name: 'User',
    keywords: 'person customer human actor account client people',
    draw: (p) => {
      p.tub(0, 0, 0.3, 0.13, 0, 0.42);
      p.ball(0, 0, 0.6, 0.15);
    }
  },
  {
    id: 'vm',
    name: 'Virtual machine',
    keywords: 'vm ec2 instance compute virtual host droplet',
    draw: (p) => {
      const f = p.block(0.62, 0.62, 0.6);
      const inset = [[0.16, 0.16], [0.84, 0.16], [0.84, 0.84], [0.16, 0.84]] as const;
      for (const face of [f.left, f.right, f.top]) p.line(on(face, inset), { soft: true, close: true });
    }
  },
  {
    id: 'database',
    name: 'Database',
    keywords: 'db sql postgres postgresql mysql sqlite rds aurora neon data mongo mongodb dynamodb',
    draw: (p) => {
      p.tub(0, 0, 0.36, 0.36, 0, 0.7);
      p.hoop(0, 0, 0.36, 0.25);
      p.hoop(0, 0, 0.36, 0.48);
    }
  },
  {
    id: 'bucket',
    name: 'Bucket',
    keywords: 's3 r2 gcs blob object storage files bucket',
    draw: (p) => {
      p.tub(0, 0, 0.26, 0.4, 0, 0.56);
      p.hoop(0, 0, 0.37, 0.46, true);
    }
  },
  {
    id: 'api',
    name: 'API',
    keywords: 'endpoint rest graphql grpc interface socket plug http',
    draw: (p) => {
      const f = p.block(0.56, 0.56, 0.48);
      for (const u of [0.32, 0.68]) p.mark(on(f.right, [[u - 0.05, 0.52], [u + 0.05, 0.52], [u + 0.05, 0.82], [u - 0.05, 0.82]]));
      p.mark(on(f.right, [[0.42, 0.18], [0.58, 0.18], [0.58, 0.36], [0.42, 0.36]]));
    }
  },
  {
    id: 'gateway',
    name: 'Gateway',
    keywords: 'api gateway ingress edge entry portal apigateway',
    draw: (p) => {
      p.box(0.18, -0.14, 0.38, 0.14, 0, 0.5);
      p.box(-0.38, -0.14, -0.18, 0.14, 0, 0.5);
      p.box(-0.42, -0.18, 0.42, 0.18, 0.5, 0.7);
    }
  },
  {
    id: 'browser',
    name: 'Browser',
    keywords: 'web app frontend website page spa client chrome',
    draw: (p) => {
      const f = p.box(-0.38, 0, 0.38, 0.06, 0, 0.62);
      p.line(on(f.right, [[0, 0.8], [1, 0.8]]));
      for (const u of [0.08, 0.15, 0.22]) p.dot(f.right(u, 0.9), 2.4);
      for (const [v, end] of [[0.6, 0.8], [0.44, 0.6], [0.28, 0.7]] as const) p.line(on(f.right, [[0.1, v], [end, v]]), { soft: true });
    }
  },
  {
    id: 'service',
    name: 'Service',
    keywords: 'microservice app application backend daemon process',
    draw: (p) => {
      const hexagon = Array.from({ length: 6 }, (_, side) => {
        const angle = ((side * 60 + 15) * Math.PI) / 180;
        return [0.4 * Math.cos(angle), 0.4 * Math.sin(angle)] as const;
      });
      p.prism(hexagon, 0, 0.42);
      p.mark([flat(-0.1, 0.14, 0.42), flat(-0.1, -0.14, 0.42), flat(0.16, 0, 0.42)]);
    }
  },
  {
    id: 'worker',
    name: 'Worker',
    keywords: 'background job consumer processor cron task runner celery sidekiq',
    draw: (p) => {
      const t = p.tub(0, 0, 0.38, 0.38, 0, 0.36);
      const arc = Array.from({ length: 22 }, (_, step) => {
        const angle = ((40 + step * 13) * Math.PI) / 180;
        return [0.58 * Math.cos(angle), 0.58 * Math.sin(angle)] as const;
      });
      p.line(on(t.top, arc), { width: 3.5 });
      const end = arc[0];
      p.mark(on(t.top, [[end[0] + 0.2, end[1] - 0.06], [end[0] - 0.1, end[1] - 0.2], [end[0] - 0.04, end[1] + 0.14]]));
    }
  },
  {
    id: 'container',
    name: 'Container',
    keywords: 'docker image pod kubernetes oci ecs fargate',
    draw: (p) => {
      const f = p.box(-0.44, -0.2, 0.44, 0.2, 0, 0.4);
      for (let u = 0.1; u < 0.95; u += 0.1) p.line(on(f.right, [[u, 0.12], [u, 0.88]]), { soft: true });
      p.line(on(f.left, [[0.5, 0.1], [0.5, 0.9]]));
    }
  },
  {
    id: 'cluster',
    name: 'Cluster',
    keywords: 'kubernetes k8s eks gke nodes pool fleet group',
    draw: (p) => {
      for (const [cx, cy] of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]] as const) p.block(0.3, 0.3, 0.3, 0, cx, cy);
    }
  },
  {
    id: 'table',
    name: 'Table',
    keywords: 'spreadsheet rows columns grid dataset schema',
    draw: (p) => {
      const f = p.block(0.78, 0.78, 0.14);
      for (const u of [1 / 3, 2 / 3]) p.line(on(f.top, [[u, 0.06], [u, 0.94]]));
      for (const v of [0.25, 0.5, 0.75]) p.line(on(f.top, [[0.06, v], [0.94, v]]), { soft: v !== 0.75 });
    }
  },
  {
    id: 'stream',
    name: 'Stream',
    keywords: 'events kinesis flow realtime pipe feed websocket',
    draw: (p) => {
      const f = p.block(0.8, 0.8, 0.12);
      for (const v of [0.25, 0.5, 0.75]) {
        p.line(
          Array.from({ length: 13 }, (_, step) => f.top(0.08 + step * 0.07, v + 0.06 * Math.sin(step * 1.1))),
          { width: 3 }
        );
      }
    }
  },
  {
    id: 'search',
    name: 'Search',
    keywords: 'find lookup index elasticsearch opensearch query magnifier',
    draw: (p) => {
      p.block(0.5, 0.5, 0.03);
      const lens = uprightRing(-0.08, 0, 0.5, 0.27, 0, 360, 32);
      p.shape(lens, TOP);
      p.band([at(0.12, 0, 0.3), at(0.36, 0, 0.05)], 14);
      p.band(lens, 10, true);
    }
  },
  {
    id: 'chart',
    name: 'Chart',
    keywords: 'metrics analytics dashboard graph monitoring stats grafana',
    draw: (p) => {
      p.block(0.2, 0.3, 0.74, 0, 0.27);
      p.block(0.2, 0.3, 0.5, 0, 0);
      p.block(0.2, 0.3, 0.28, 0, -0.27);
    }
  },
  {
    id: 'log',
    name: 'Log',
    keywords: 'logs audit trail journal events record history',
    draw: (p) => {
      for (const [z, shift] of [[0, 0.06], [0.08, 0.03], [0.16, 0]] as const) {
        const f = p.block(0.62, 0.72, 0.05, z, shift, shift);
        if (z === 0.16) for (const u of [0.25, 0.45, 0.65]) p.line(on(f.top, [[u, 0.12], [u, u === 0.65 ? 0.6 : 0.88]]), { soft: true });
      }
    }
  },
  {
    id: 'key',
    name: 'Key',
    keywords: 'secret credential api key token auth kms password',
    draw: (p) => {
      const bow = p.tub(0.24, 0.02, 0.18, 0.18, 0, 0.12);
      p.shape(ring(bow.top, 0, 0, 0.42), LEFT);
      p.box(-0.44, -0.05, 0.08, 0.07, 0, 0.12);
      p.box(-0.42, -0.18, -0.32, -0.05, 0, 0.12);
      p.box(-0.25, -0.16, -0.16, -0.05, 0, 0.12);
    }
  },
  {
    id: 'vault',
    name: 'Vault',
    keywords: 'secrets manager safe hashicorp kms keystore',
    draw: (p) => {
      const f = p.block(0.66, 0.66, 0.62);
      p.line(ring(f.right, 0.5, 0.5, 0.22), { close: true, width: 3 });
      for (const angle of [0, 120, 240]) {
        const radians = (angle * Math.PI) / 180;
        p.line(on(f.right, [[0.5, 0.5], [0.5 + 0.2 * Math.cos(radians), 0.5 + 0.2 * Math.sin(radians)]]), { width: 3 });
      }
      p.dot(f.right(0.5, 0.5), 3.5);
      for (const v of [0.25, 0.75]) p.mark(on(f.left, [[0.04, v - 0.06], [0.12, v - 0.06], [0.12, v + 0.06], [0.04, v + 0.06]]));
    }
  },
  {
    id: 'shield',
    name: 'Shield',
    keywords: 'security protection guard defence policy compliance waf',
    draw: (p) => {
      const outline = (y: number): Pt[] => [
        at(-0.32, y, 0.74), at(0.32, y, 0.74), at(0.32, y, 0.4), at(0.24, y, 0.22), at(0.12, y, 0.1),
        at(0, y, 0.03), at(-0.12, y, 0.1), at(-0.24, y, 0.22), at(-0.32, y, 0.4)
      ];
      p.shape(outline(0.08), LEFT);
      p.shape(outline(0), TOP);
      p.line([at(0, 0, 0.66), at(0, 0, 0.12)], { soft: true, width: 3 });
    }
  },
  {
    id: 'bell',
    name: 'Bell',
    keywords: 'alert notification alarm pager oncall alerting',
    draw: (p) => {
      p.tub(0, 0, 0.4, 0.4, 0, 0.08);
      p.tub(0, 0, 0.32, 0.14, 0.08, 0.58);
      p.ball(0, 0, 0.64, 0.06);
    }
  },
  {
    id: 'code',
    name: 'Code',
    keywords: 'source script program sdk snippet developer ide',
    draw: (p) => {
      const f = p.block(0.72, 0.72, 0.34);
      p.line(on(f.right, [[0.3, 0.8], [0.16, 0.5], [0.3, 0.2]]), { width: 3.5 });
      p.line(on(f.right, [[0.7, 0.8], [0.84, 0.5], [0.7, 0.2]]), { width: 3.5 });
      p.line(on(f.right, [[0.58, 0.84], [0.42, 0.16]]), { width: 3.5 });
    }
  },
  {
    id: 'repo',
    name: 'Repository',
    keywords: 'git github gitlab repo branch version control source',
    draw: (p) => {
      const f = p.block(0.56, 0.66, 0.5);
      p.line(on(f.right, [[0.34, 0.18], [0.34, 0.82]]), { width: 3 });
      p.line(on(f.right, [[0.34, 0.36], [0.66, 0.5], [0.66, 0.66]]), { width: 3 });
      for (const [u, v] of [[0.34, 0.18], [0.34, 0.82], [0.66, 0.66]] as const) p.dot(f.right(u, v), 4);
    }
  },
  {
    id: 'pipeline',
    name: 'Pipeline',
    keywords: 'ci cd build deploy workflow github actions jenkins etl stages',
    draw: (p) => {
      p.box(-0.46, -0.12, 0.46, 0.12, 0, 0.08);
      for (const cx of [0.3, 0, -0.3]) p.block(0.2, 0.2, 0.22, 0.08, cx);
    }
  },
  {
    id: 'agent',
    name: 'Agent',
    keywords: 'bot ai assistant robot llm automation copilot claude',
    draw: (p) => {
      p.line([at(0, 0, 0.5), at(0, 0, 0.66)], { width: 3 });
      p.dot(at(0, 0, 0.68), 4.5);
      p.block(0.2, 0.2, 0.1);
      const head = p.block(0.56, 0.5, 0.38, 0.1);
      for (const u of [0.3, 0.7]) p.dot(head.right(u, 0.58), 5);
      p.line(on(head.right, [[0.32, 0.28], [0.68, 0.28]]), { soft: true, width: 3 });
    }
  },
  {
    id: 'model',
    name: 'Model',
    keywords: 'ai ml llm neural network inference gpt embedding',
    draw: (p) => {
      p.block(0.76, 0.76, 0.1, 0);
      p.block(0.6, 0.6, 0.1, 0.18);
      const top = p.block(0.44, 0.44, 0.1, 0.36);
      const star = Array.from({ length: 8 }, (_, step) => {
        const angle = (step * Math.PI) / 4;
        const reach = step % 2 === 0 ? 0.42 : 0.12;
        return [0.5 + reach * Math.cos(angle), 0.5 + reach * Math.sin(angle)] as const;
      });
      p.mark(on(top.top, star));
    }
  },
  {
    id: 'webhook',
    name: 'Webhook',
    keywords: 'callback hook http event notify integration',
    draw: (p) => {
      p.tub(0, 0, 0.34, 0.34, 0, 0.14);
      p.band([at(0, 0, 0.62), at(0, 0, 0.34), ...uprightRing(-0.11, 0, 0.34, 0.11, 0, -180, 10)], 9);
      p.band(uprightRing(0, 0, 0.7, 0.08, 0, 360, 18), 8, true);
    }
  },
  {
    id: 'wallet',
    name: 'Wallet',
    keywords: 'crypto wallet funds balance money account web3',
    draw: (p) => {
      const f = p.block(0.72, 0.4, 0.44);
      p.line(on(f.right, [[0, 0.66], [0.62, 0.66], [0.62, 0.36], [1, 0.36]]));
      p.dot(f.right(0.8, 0.52), 4);
    }
  },
  {
    id: 'bank',
    name: 'Bank',
    keywords: 'finance institution payments treasury money ledger',
    draw: (p) => {
      p.block(0.84, 0.64, 0.08);
      const body = p.block(0.7, 0.5, 0.32, 0.08);
      for (const u of [0.16, 0.38, 0.62, 0.84]) p.line(on(body.right, [[u, 0.1], [u, 0.9]]), { width: 3.5 });
      p.roof(-0.42, -0.32, 0.42, 0.32, 0.4, 0.62);
    }
  },
  {
    id: 'chain',
    name: 'Chain',
    keywords: 'blockchain link ethereum solana onchain ledger dependency',
    draw: (p) => {
      const far: Pt[] = Array.from({ length: 29 }, (_, step) => {
        const angle = (step * 2 * Math.PI) / 28;
        return at(0.16, 0.2 * Math.cos(angle), 0.36 + 0.2 * Math.sin(angle));
      });
      p.band(far, 10, true);
      p.band(uprightRing(-0.16, 0, 0.36, 0.2), 10, true);
    }
  },
  {
    id: 'globe',
    name: 'Globe',
    keywords: 'world internet global web region worldwide public',
    draw: (p) => {
      const { center, radius } = p.ball(0, 0, 0.36, 0.34);
      const [x, y] = center;
      p.line(Array.from({ length: 29 }, (_, step) => {
        const angle = (step * 2 * Math.PI) / 28;
        return [x + radius * 0.42 * Math.cos(angle), y + radius * Math.sin(angle)] as Pt;
      }), { soft: true });
      p.line(Array.from({ length: 15 }, (_, step) => {
        const angle = (step * Math.PI) / 14;
        return [x + radius * Math.cos(angle), y + radius * 0.32 * Math.sin(angle)] as Pt;
      }), { soft: true });
    }
  },
  {
    id: 'cdn',
    name: 'CDN',
    keywords: 'cloudfront cloudflare edge cache content delivery fastly akamai',
    draw: (p) => {
      const ends = [[0.34, 0.34], [-0.38, 0.18], [0.18, -0.38]] as const;
      for (const [x, y] of ends) p.line([at(0, 0, 0.02), at(x, y, 0.02)], { width: 3 });
      p.block(0.16, 0.16, 0.16, 0, 0.34, 0.34);
      p.tub(0, 0, 0.17, 0.17, 0, 0.46);
      p.block(0.16, 0.16, 0.16, 0, -0.38, 0.18);
      p.block(0.16, 0.16, 0.16, 0, 0.18, -0.38);
    }
  },
  {
    id: 'users',
    name: 'Users',
    keywords: 'people team group customers audience accounts',
    draw: (p) => {
      const [bx, by] = spot(0.2, 0.12);
      const [fx, fy] = spot(-0.16, -0.12);
      p.tub(bx, by, 0.24, 0.1, 0, 0.34);
      p.ball(bx, by, 0.47, 0.12);
      p.tub(fx, fy, 0.26, 0.11, 0, 0.36);
      p.ball(fx, fy, 0.5, 0.13);
    }
  },
  {
    id: 'folder',
    name: 'Folder',
    keywords: 'directory files filesystem drive share',
    draw: (p) => {
      p.box(-0.38, 0.08, -0.06, 0.12, 0.48, 0.58);
      p.box(-0.38, 0.08, 0.38, 0.12, 0, 0.5);
      p.box(-0.38, 0, 0.38, 0.04, 0, 0.42);
    }
  },
  {
    id: 'gear',
    name: 'Gear',
    keywords: 'settings config configuration ops admin cog',
    draw: (p) => {
      const outline: [number, number][] = [];
      for (let tooth = 0; tooth < 8; tooth++) {
        const middle = (tooth * Math.PI) / 4;
        for (const [offset, radius] of [[-0.26, 0.3], [-0.14, 0.42], [0.14, 0.42], [0.26, 0.3]] as const) {
          outline.push([radius * Math.cos(middle + offset), radius * Math.sin(middle + offset)]);
        }
      }
      p.prism(outline, 0, 0.22);
      p.shape(Array.from({ length: 24 }, (_, step) => {
        const angle = (step * 2 * Math.PI) / 24;
        return at(0.12 * Math.cos(angle), 0.12 * Math.sin(angle), 0.22);
      }), LEFT);
    }
  }
];

export const ICON_DEFINITIONS: readonly IconDefinition[] = ICONS;
