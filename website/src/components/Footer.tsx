import { Github, FileText, Heart } from "lucide-react";

const links = [
  {
    label: "GitHub 仓库",
    href: "https://github.com/MorganArthur/mimodex",
    icon: Github,
  },
  {
    label: "产品需求文档",
    href: "https://github.com/MorganArthur/mimodex/blob/main/docs/product/PRD.md",
    icon: FileText,
  },
  {
    label: "当前状态",
    href: "https://github.com/MorganArthur/mimodex/blob/main/docs/CURRENT_STATUS.md",
    icon: FileText,
  },
  {
    label: "架构决策",
    href: "https://github.com/MorganArthur/mimodex/tree/main/docs/architecture/decisions",
    icon: FileText,
  },
];

export default function Footer() {
  return (
    <footer className="relative py-16 bg-dark-950 border-t border-dark-800">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand-400 flex items-center justify-center">
                <span className="text-dark-950 font-mono font-bold text-xl">M</span>
              </div>
              <span className="font-mono text-2xl font-bold text-white tracking-tight">
                Mimodex
              </span>
            </div>
            <p className="text-dark-500 text-sm max-w-md leading-relaxed">
              本地优先桌面编程 Agent。由小米 MiMo 驱动，像 Codex 一样工作，把对话线程、项目文件、Git 变更集中到一个 Windows 桌面应用中。
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">文档</h4>
            <ul className="space-y-3">
              {links.slice(1).map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-dark-500 hover:text-brand-400 transition-colors text-sm"
                  >
                    <link.icon className="w-4 h-4" />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* GitHub */}
          <div>
            <h4 className="text-white font-semibold mb-4">仓库</h4>
            <a
              href={links[0].href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-900 border border-dark-800 text-dark-400 hover:text-brand-400 hover:border-brand-400/30 transition-colors text-sm"
            >
              <Github className="w-4 h-4" />
              MorganArthur/mimodex
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-dark-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-dark-600 text-xs">
            当前仓库尚未提供正式 LICENSE 文件
          </p>
          <p className="flex items-center gap-1 text-dark-600 text-xs">
            用 <Heart className="w-3 h-3 text-red-500/70" /> 和 MiMo 构建
          </p>
        </div>
      </div>
    </footer>
  );
}
