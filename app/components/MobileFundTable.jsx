'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { throttle } from 'lodash';
import FitText from './FitText';
import MobileFundCardDrawer from './MobileFundCardDrawer';
import MobileSettingModal from './MobileSettingModal';
import ConfirmModal from './ConfirmModal';
import { CloseIcon, DragIcon, SettingsIcon, SortIcon, StarIcon, TrashIcon } from './Icons';
import { fetchFundPeriodReturns, fetchRelatedSectors, fetchRelatedSectorLiveQuote } from '@/app/api/fund';

const MOBILE_NON_FROZEN_COLUMN_IDS = [
  'relatedSector',
  'period1w',
  'period1m',
  'period3m',
  'period6m',
  'period1y',
  'yesterdayChangePercent',
  'estimateChangePercent',
  'totalChangePercent',
  'holdingDays',
  'todayProfit',
  'yesterdayProfit',
  'holdingProfit',
  'latestNav',
  'estimateNav',
];
const MOBILE_COLUMN_HEADERS = {
  relatedSector: '关联板块',
  period1w: '近1周',
  period1m: '近1月',
  period3m: '近3月',
  period6m: '近6月',
  period1y: '近1年',
  latestNav: '最新净值',
  estimateNav: '估算净值',
  yesterdayChangePercent: '最新涨幅',
  estimateChangePercent: '估算涨幅',
  totalChangePercent: '估算收益',
  holdingDays: '持有天数',
  todayProfit: '当日收益',
  yesterdayProfit: '昨日收益',
  holdingProfit: '持有收益',
};

const RowSortableContext = createContext(null);

function SortableRow({ row, children, isTableDragging, disabled }) {
  const {
    attributes,
    listeners,
    transform,
    transition,
    setNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useSortable({ id: row.original.code, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999, opacity: 0.8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' } : {}),
  };

  return (
    <motion.div
      ref={setNodeRef}
      className="table-row-wrapper"
      layout={isTableDragging ? undefined : 'position'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{ ...style, position: 'relative' }}
      {...attributes}
    >
      <RowSortableContext.Provider value={{ setActivatorNodeRef, listeners }}>
        {typeof children === 'function' ? children(setActivatorNodeRef, listeners) : children}
      </RowSortableContext.Provider>
    </motion.div>
  );
}

/**
 * 移动端基金列表表格组件（基于 @tanstack/react-table，与 PcFundTable 相同数据结构）
 *
 * @param {Object} props - 与 PcFundTable 一致
 * @param {Array<Object>} props.data - 表格数据（与 pcFundTableData 同结构）
 * @param {(row: any) => void} [props.onRemoveFund] - 删除基金
 * @param {string} [props.currentTab] - 当前分组
 * @param {Set<string>} [props.favorites] - 自选集合
 * @param {(row: any) => void} [props.onToggleFavorite] - 添加/取消自选
 * @param {(row: any, meta: { hasHolding: boolean }) => void} [props.onHoldingAmountClick] - 点击持仓金额
 * @param {boolean} [props.refreshing] - 是否刷新中
 * @param {string} [props.sortBy] - 排序方式，'default' 时长按行触发拖拽排序
 * @param {(oldIndex: number, newIndex: number) => void} [props.onReorder] - 拖拽排序回调
 * @param {(row: any) => Object} [props.getFundCardProps] - 给定行返回 FundCard 的 props；传入后点击基金名称将用底部弹框展示卡片视图
 * @param {boolean} [props.masked] - 是否隐藏持仓相关金额
 * @param {string} [props.relatedSectorSessionKey] - 登录用户 id（未登录传空），用于关联板块查询缓存与登录后重新拉取
 * @param {(items: { code: string; name?: string }[]) => void} [props.onBulkRemoveFundsConfirmed] - 批量删除二次确认后执行（与单条删除作用域一致）
 * @param {(open: boolean) => void} [props.onFundCardDrawerOpenChange] - 基金详情底部 Drawer 打开/关闭时通知父级（用于隐藏底栏等）
 * @param {(open: boolean) => void} [props.onMobileSettingModalOpenChange] - 移动端表格「个性化设置」弹框打开/关闭时通知父级（用于隐藏底栏等）
 */
export default function MobileFundTable({
  data = [],
  onRemoveFund,
  currentTab,
  favorites = new Set(),
  onToggleFavorite,
  onHoldingAmountClick,
  onHoldingProfitClick, // 保留以兼容调用方，表格内已不再使用点击切换
  refreshing = false,
  sortBy = 'default',
  onReorder,
  onCustomSettingsChange,
  stickyTop = 0,
  getFundCardProps,
  blockDrawerClose = false,
  closeDrawerRef,
  masked = false,
  relatedSectorSessionKey = '',
  onBulkRemoveFundsConfirmed,
  onFundCardDrawerOpenChange,
  onMobileSettingModalOpenChange,
}) {
  const [isNameSortMode, setIsNameSortMode] = useState(false);
  const [isBulkDeleteMode, setIsBulkDeleteMode] = useState(false);
  const [bulkSelectedCodes, setBulkSelectedCodes] = useState(() => new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const bulkLongPressRef = useRef({ timer: null, startX: 0, startY: 0 });
  const ignoreNextBulkRowClickRef = useRef(false);

  const clearBulkLongPressTimer = useCallback(() => {
    if (bulkLongPressRef.current.timer) {
      clearTimeout(bulkLongPressRef.current.timer);
      bulkLongPressRef.current.timer = null;
    }
  }, []);

  const exitBulkDeleteMode = useCallback(() => {
    clearBulkLongPressTimer();
    setIsBulkDeleteMode(false);
    setBulkSelectedCodes(new Set());
    setBulkDeleteConfirmOpen(false);
  }, [clearBulkLongPressTimer]);

  useEffect(() => () => clearBulkLongPressTimer(), [clearBulkLongPressTimer]);

  // 排序模式下拖拽手柄无需长按，直接拖动即可；非排序模式长按整行触发拖拽
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isNameSortMode ? { delay: 0, tolerance: 5 } : { delay: 400, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const [activeId, setActiveId] = useState(null);
  const ignoreNextDrawerCloseRef = useRef(false);

  const onToggleFavoriteRef = useRef(onToggleFavorite);
  const onRemoveFundRef = useRef(onRemoveFund);
  const onHoldingAmountClickRef = useRef(onHoldingAmountClick);

  useEffect(() => {
    if (closeDrawerRef) {
      closeDrawerRef.current = () => setCardSheetRow(null);
      return () => { closeDrawerRef.current = null; };
    }
  }, [closeDrawerRef]);

  useEffect(() => {
    onToggleFavoriteRef.current = onToggleFavorite;
    onRemoveFundRef.current = onRemoveFund;
    onHoldingAmountClickRef.current = onHoldingAmountClick;
  }, [
    onToggleFavorite,
    onRemoveFund,
    onHoldingAmountClick,
  ]);

  const handleDragStart = (e) => setActiveId(e.active.id);
  const handleDragCancel = () => setActiveId(null);
  const handleDragEnd = (e) => {
    const { active, over } = e;
    if (active && over && active.id !== over.id && onReorder) {
      const oldIndex = data.findIndex((item) => item.code === active.id);
      const newIndex = data.findIndex((item) => item.code === over.id);
      if (oldIndex !== -1 && newIndex !== -1) onReorder(oldIndex, newIndex);
    }
    setActiveId(null);
  };

  const groupKey = currentTab ?? 'all';

  const getCustomSettingsWithMigration = () => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem('customSettings');
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      if (parsed.pcTableColumnOrder != null || parsed.pcTableColumnVisibility != null || parsed.pcTableColumns != null || parsed.mobileTableColumnOrder != null || parsed.mobileTableColumnVisibility != null) {
        const all = {
          ...(parsed.all && typeof parsed.all === 'object' ? parsed.all : {}),
          pcTableColumnOrder: parsed.pcTableColumnOrder,
          pcTableColumnVisibility: parsed.pcTableColumnVisibility,
          pcTableColumns: parsed.pcTableColumns,
          mobileTableColumnOrder: parsed.mobileTableColumnOrder,
          mobileTableColumnVisibility: parsed.mobileTableColumnVisibility,
        };
        delete parsed.pcTableColumnOrder;
        delete parsed.pcTableColumnVisibility;
        delete parsed.pcTableColumns;
        delete parsed.mobileTableColumnOrder;
        delete parsed.mobileTableColumnVisibility;
        parsed.all = all;
        window.localStorage.setItem('customSettings', JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return {};
    }
  };

  const getInitialMobileConfigByGroup = () => {
    const parsed = getCustomSettingsWithMigration();
    const byGroup = {};
    Object.keys(parsed).forEach((k) => {
      if (k === 'pcContainerWidth') return;
      const group = parsed[k];
      if (!group || typeof group !== 'object') return;
      const order = Array.isArray(group.mobileTableColumnOrder) && group.mobileTableColumnOrder.length > 0
        ? group.mobileTableColumnOrder
        : null;
      const visibility = group.mobileTableColumnVisibility && typeof group.mobileTableColumnVisibility === 'object'
        ? group.mobileTableColumnVisibility
        : null;
      byGroup[k] = {
        mobileTableColumnOrder: order ? (() => {
          const valid = order.filter((id) => MOBILE_NON_FROZEN_COLUMN_IDS.includes(id));
          const missing = MOBILE_NON_FROZEN_COLUMN_IDS.filter((id) => !valid.includes(id));
          return [...valid, ...missing];
        })() : null,
        mobileTableColumnVisibility: visibility,
        mobileShowFullFundName: group.mobileShowFullFundName === true,
      };
    });
    return byGroup;
  };

  const [configByGroup, setConfigByGroup] = useState(getInitialMobileConfigByGroup);

  const currentGroupMobile = configByGroup[groupKey];
  const showFullFundName = currentGroupMobile?.mobileShowFullFundName ?? false;
  const defaultOrder = [...MOBILE_NON_FROZEN_COLUMN_IDS];
  const defaultVisibility = (() => {
    const o = {};
    MOBILE_NON_FROZEN_COLUMN_IDS.forEach((id) => { o[id] = true; });
    // 新增列：默认隐藏（用户可在表格设置中开启）
    o.relatedSector = false;
    o.holdingDays = false;
    o.period1w = false;
    o.period1m = false;
    o.period3m = false;
    o.period6m = false;
    o.period1y = false;
    o.yesterdayProfit = false;
    return o;
  })();

  const mobileColumnOrder = (() => {
    const order = currentGroupMobile?.mobileTableColumnOrder ?? defaultOrder;
    if (!Array.isArray(order) || order.length === 0) return [...MOBILE_NON_FROZEN_COLUMN_IDS];
    const valid = order.filter((id) => MOBILE_NON_FROZEN_COLUMN_IDS.includes(id));
    const missing = MOBILE_NON_FROZEN_COLUMN_IDS.filter((id) => !valid.includes(id));
    return [...valid, ...missing];
  })();
  const mobileColumnVisibility = (() => {
    const vis = currentGroupMobile?.mobileTableColumnVisibility ?? null;
    if (vis && typeof vis === 'object' && Object.keys(vis).length > 0) {
      const next = { ...vis };
      if (next.relatedSector === undefined) next.relatedSector = false;
      if (next.holdingDays === undefined) next.holdingDays = false;
      if (next.period1w === undefined) next.period1w = false;
      if (next.period1m === undefined) next.period1m = false;
      if (next.period3m === undefined) next.period3m = false;
      if (next.period6m === undefined) next.period6m = false;
      if (next.period1y === undefined) next.period1y = false;
      if (next.yesterdayProfit === undefined) next.yesterdayProfit = false;
      return next;
    }
    return defaultVisibility;
  })();

  const persistMobileGroupConfig = (updates) => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('customSettings');
      const parsed = raw ? JSON.parse(raw) : {};
      const group = parsed[groupKey] && typeof parsed[groupKey] === 'object' ? { ...parsed[groupKey] } : {};
      if (updates.mobileTableColumnOrder !== undefined) group.mobileTableColumnOrder = updates.mobileTableColumnOrder;
      if (updates.mobileTableColumnVisibility !== undefined) group.mobileTableColumnVisibility = updates.mobileTableColumnVisibility;
      parsed[groupKey] = group;
      window.localStorage.setItem('customSettings', JSON.stringify(parsed));
      setConfigByGroup((prev) => ({ ...prev, [groupKey]: { ...prev[groupKey], ...updates } }));
      onCustomSettingsChange?.();
    } catch {}
  };

  const setMobileColumnOrder = (nextOrderOrUpdater) => {
    const next = typeof nextOrderOrUpdater === 'function'
      ? nextOrderOrUpdater(mobileColumnOrder)
      : nextOrderOrUpdater;
    persistMobileGroupConfig({ mobileTableColumnOrder: next });
  };
  const setMobileColumnVisibility = (nextOrUpdater) => {
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(mobileColumnVisibility)
      : nextOrUpdater;
    persistMobileGroupConfig({ mobileTableColumnVisibility: next });
  };

  const persistShowFullFundName = (show) => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('customSettings');
      const parsed = raw ? JSON.parse(raw) : {};
      const group = parsed[groupKey] && typeof parsed[groupKey] === 'object' ? { ...parsed[groupKey] } : {};
      group.mobileShowFullFundName = show;
      parsed[groupKey] = group;
      window.localStorage.setItem('customSettings', JSON.stringify(parsed));
      setConfigByGroup((prev) => ({
        ...prev,
        [groupKey]: { ...prev[groupKey], mobileShowFullFundName: show }
      }));
      onCustomSettingsChange?.();
    } catch {}
  };

  const handleToggleShowFullFundName = (show) => {
    persistShowFullFundName(show);
  };

  const [settingModalOpen, setSettingModalOpen] = useState(false);

  useEffect(() => {
    onMobileSettingModalOpenChange?.(settingModalOpen);
  }, [settingModalOpen, onMobileSettingModalOpenChange]);

  useEffect(() => {
    if (sortBy !== 'default') setIsNameSortMode(false);
  }, [sortBy]);

  useEffect(() => {
    if (sortBy !== 'default') exitBulkDeleteMode();
  }, [sortBy, exitBulkDeleteMode]);

  // 排序模式下，点击页面任意区域（含表格外）退出排序；使用冒泡阶段，避免先于排序按钮处理
  useEffect(() => {
    if (!isNameSortMode) return;
    const onDocClick = () => setIsNameSortMode(false);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [isNameSortMode]);

  const [cardSheetRow, setCardSheetRow] = useState(null);

  const fundCardDrawerOpen = !!(cardSheetRow && getFundCardProps);
  useEffect(() => {
    onFundCardDrawerOpenChange?.(fundCardDrawerOpen);
  }, [fundCardDrawerOpen, onFundCardDrawerOpenChange]);

  useEffect(() => {
    return () => {
      onFundCardDrawerOpenChange?.(false);
      onMobileSettingModalOpenChange?.(false);
    };
  }, [onFundCardDrawerOpenChange, onMobileSettingModalOpenChange]);

  const tableContainerRef = useRef(null);
  const portalHeaderRef = useRef(null);
  const [tableContainerWidth, setTableContainerWidth] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPortalHeader, setShowPortalHeader] = useState(false);
  const [effectiveStickyTop, setEffectiveStickyTop] = useState(stickyTop);

  /* 捕获阶段拦截 selectstart，双保险（部分 Android WebView / iOS 上仅靠 CSS 仍会划选） */
  useLayoutEffect(() => {
    const root = tableContainerRef.current;
    if (!root) return;
    const onSelectStart = (e) => {
      e.preventDefault();
    };
    root.addEventListener('selectstart', onSelectStart, { capture: true });
    return () => root.removeEventListener('selectstart', onSelectStart, { capture: true });
  }, []);

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const updateWidth = () => setTableContainerWidth(el.clientWidth || 0);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const getEffectiveStickyTop = () => {
      const stickySummaryCard = document.querySelector('.group-summary-sticky .group-summary-card');
      if (!stickySummaryCard) return stickyTop;

      const stickySummaryWrapper = stickySummaryCard.closest('.group-summary-sticky');
      if (!stickySummaryWrapper) return stickyTop;

      const wrapperRect = stickySummaryWrapper.getBoundingClientRect();
      // 用“实际 DOM 的 top”判断 sticky 是否已生效，避免 mobile 下 stickyTop 入参与 GroupSummary 不一致导致的偏移。
      const computedTopStr = window.getComputedStyle(stickySummaryWrapper).top;
      const computedTop = Number.parseFloat(computedTopStr);
      const baseTop = Number.isFinite(computedTop) ? computedTop : stickyTop;
      const isSummaryStuck = wrapperRect.top <= baseTop + 1;

      // header 使用固定定位(top)，所以也用视口坐标系下的 wrapperRect.top + 高度，确保不重叠
      return isSummaryStuck ? wrapperRect.top + stickySummaryWrapper.offsetHeight : stickyTop;
    };

    const updateVerticalState = () => {
      const nextStickyTop = getEffectiveStickyTop();
      setEffectiveStickyTop((prev) => (prev === nextStickyTop ? prev : nextStickyTop));

      const tableEl = tableContainerRef.current;
      const tableRect = tableEl?.getBoundingClientRect();
      if (!tableRect) {
        setShowPortalHeader(window.scrollY >= nextStickyTop);
        return;
      }

      const headerEl = tableEl?.querySelector('.table-header-row');
      const headerHeight = headerEl?.getBoundingClientRect?.().height ?? 0;
      const hasPassedHeader = (tableRect.top + headerHeight) <= nextStickyTop;
      const hasTableInView = tableRect.bottom > nextStickyTop;

      setShowPortalHeader(hasPassedHeader && hasTableInView);
    };

    const throttledVerticalUpdate = throttle(updateVerticalState, 1000/60, { leading: true, trailing: true });

    updateVerticalState();
    window.addEventListener('scroll', throttledVerticalUpdate, { passive: true });
    window.addEventListener('resize', throttledVerticalUpdate, { passive: true });
    return () => {
      window.removeEventListener('scroll', throttledVerticalUpdate);
      window.removeEventListener('resize', throttledVerticalUpdate);
      throttledVerticalUpdate.cancel();
    };
  }, [stickyTop]);

  useEffect(() => {
    const tableEl = tableContainerRef.current;
    if (!tableEl) return;

    const handleScroll = () => {
      setIsScrolled(tableEl.scrollLeft > 0);
    };

    handleScroll();
    tableEl.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      tableEl.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const tableEl = tableContainerRef.current;
    const portalEl = portalHeaderRef.current;
    if (!tableEl || !portalEl) return;

    const syncScrollToPortal = () => {
      portalEl.scrollLeft = tableEl.scrollLeft;
    };

    const syncScrollToTable = () => {
      tableEl.scrollLeft = portalEl.scrollLeft;
    };

    syncScrollToPortal();

    const handleTableScroll = () => syncScrollToPortal();
    const handlePortalScroll = () => syncScrollToTable();

    tableEl.addEventListener('scroll', handleTableScroll, { passive: true });

    return () => {
      tableEl.removeEventListener('scroll', handleTableScroll);
    };
  }, [showPortalHeader]);

  const NAME_CELL_WIDTH = 140;
  const GAP = 12;
  const LAST_COLUMN_EXTRA = 12;
  const FALLBACK_WIDTHS = {
    fundName: 140,
    relatedSector: 120,
    period1w: 72,
    period1m: 72,
    period3m: 72,
    period6m: 72,
    period1y: 72,
    latestNav: 64,
    estimateNav: 64,
    yesterdayChangePercent: 72,
    estimateChangePercent: 80,
    totalChangePercent: 80,
    holdingDays: 64,
    todayProfit: 80,
    yesterdayProfit: 80,
    holdingProfit: 80,
  };

  const relatedSectorEnabled = mobileColumnVisibility?.relatedSector !== false;
  const relatedSectorCacheRef = useRef(new Map());
  const [relatedSectorByCode, setRelatedSectorByCode] = useState({});
  const [sectorQuoteByLabel, setSectorQuoteByLabel] = useState({});

  const sectorAuthSegment = relatedSectorSessionKey || 'anon';

  const fetchRelatedSector = useCallback(
    (code) => fetchRelatedSectors(code, { authSegment: sectorAuthSegment }),
    [sectorAuthSegment],
  );

  useEffect(() => {
    relatedSectorCacheRef.current.clear();
    setRelatedSectorByCode({});
    setSectorQuoteByLabel({});
  }, [sectorAuthSegment]);

  const runWithConcurrency = async (items, limit, worker) => {
    const queue = [...items];
    const runners = Array.from({ length: Math.max(1, limit) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item == null) continue;

        await worker(item);
      }
    });
    await Promise.all(runners);
  };

  useEffect(() => {
    if (!relatedSectorEnabled) return;
    if (!Array.isArray(data) || data.length === 0) return;

    const codes = Array.from(new Set(data.map((d) => d?.code).filter(Boolean)));
    const missing = codes.filter((code) => !relatedSectorCacheRef.current.has(code));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      await runWithConcurrency(missing, 4, async (code) => {
        const value = await fetchRelatedSector(code);
        relatedSectorCacheRef.current.set(code, value);
        if (cancelled) return;
        setRelatedSectorByCode((prev) => {
          if (prev[code] === value) return prev;
          return { ...prev, [code]: value };
        });
      });
    })();

    return () => { cancelled = true; };
  }, [relatedSectorEnabled, data, sectorAuthSegment, fetchRelatedSector]);

  useEffect(() => {
    if (!relatedSectorEnabled) return;
    if (!Array.isArray(data) || data.length === 0) return;

    const labels = new Set();
    for (const row of data) {
      const code = row?.code;
      const lbl = code && relatedSectorByCode[code];
      const t = lbl != null ? String(lbl).trim() : '';
      if (t) labels.add(t);
    }
    if (labels.size === 0) return;

    let cancelled = false;
    (async () => {
      await runWithConcurrency([...labels], 4, async (label) => {
        const quote = await fetchRelatedSectorLiveQuote(label);
        if (cancelled) return;
        setSectorQuoteByLabel((prev) => {
          const prevQ = prev[label];
          if (prevQ === quote) return prev;
          if (
            prevQ &&
            quote &&
            prevQ.pct === quote.pct &&
            prevQ.name === quote.name &&
            prevQ.code === quote.code
          ) {
            return prev;
          }
          return { ...prev, [label]: quote };
        });
      });
    })();

    return () => { cancelled = true; };
  }, [relatedSectorEnabled, data, relatedSectorByCode]);

  const periodReturnsEnabled =
    mobileColumnVisibility?.period1w !== false
    || mobileColumnVisibility?.period1m !== false
    || mobileColumnVisibility?.period3m !== false
    || mobileColumnVisibility?.period6m !== false
    || mobileColumnVisibility?.period1y !== false;
  const periodReturnsCacheRef = useRef(new Map());
  const [periodReturnsByCode, setPeriodReturnsByCode] = useState({});

  useEffect(() => {
    if (!periodReturnsEnabled) return;
    if (!Array.isArray(data) || data.length === 0) return;

    const codes = Array.from(new Set(data.map((d) => d?.code).filter(Boolean)));
    const missing = codes.filter((code) => !periodReturnsCacheRef.current.has(code));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      await runWithConcurrency(missing, 4, async (code) => {
        const value = await fetchFundPeriodReturns(code);
        periodReturnsCacheRef.current.set(code, value);
        if (cancelled) return;
        setPeriodReturnsByCode((prev) => {
          const prevVal = prev[code];
          if (
            prevVal
            && prevVal.week === value.week
            && prevVal.month === value.month
            && prevVal.month3 === value.month3
            && prevVal.month6 === value.month6
            && prevVal.year1 === value.year1
          ) {
            return prev;
          }
          return { ...prev, [code]: value };
        });
      });
    })();

    return () => { cancelled = true; };
  }, [periodReturnsEnabled, data]);

  const columnWidthMap = useMemo(() => {
    const visibleNonNameIds = mobileColumnOrder.filter((id) => mobileColumnVisibility[id] !== false);
    const nonNameCount = visibleNonNameIds.length;
    if (tableContainerWidth > 0 && nonNameCount > 0) {
      const gapTotal = nonNameCount >= 3 ? 3 * GAP : (nonNameCount) * GAP;
      const remaining = tableContainerWidth - NAME_CELL_WIDTH - gapTotal - LAST_COLUMN_EXTRA;
      const divisor = nonNameCount >= 3 ? 3 : nonNameCount;
      const otherColumnWidth = Math.max(48, Math.floor(remaining / divisor));
      const map = { fundName: NAME_CELL_WIDTH };
      MOBILE_NON_FROZEN_COLUMN_IDS.forEach((id) => {
        map[id] = otherColumnWidth;
      });
      return map;
    }
    return { ...FALLBACK_WIDTHS };
  }, [tableContainerWidth, mobileColumnOrder, mobileColumnVisibility]);

  const handleResetMobileColumnOrder = () => {
    setMobileColumnOrder([...MOBILE_NON_FROZEN_COLUMN_IDS]);
  };
  const handleResetMobileColumnVisibility = () => {
    const allVisible = {};
    MOBILE_NON_FROZEN_COLUMN_IDS.forEach((id) => {
      allVisible[id] = true;
    });
    allVisible.relatedSector = false;
    allVisible.holdingDays = false;
    allVisible.period1w = false;
    allVisible.period1m = false;
    allVisible.period3m = false;
    allVisible.period6m = false;
    allVisible.period1y = false;
    allVisible.yesterdayProfit = false;
    setMobileColumnVisibility(allVisible);
  };
  const handleToggleMobileColumnVisibility = (columnId, visible) => {
    setMobileColumnVisibility((prev = {}) => ({ ...prev, [columnId]: visible }));
  };

  const isCustomGroupTab = Boolean(currentTab && currentTab !== 'all' && currentTab !== 'fav');

  // 移动端名称列：默认排序下长按整行进入批量删除；名称排序模式下左侧为拖拽把手
  const MobileFundNameCell = ({ info, showFullFundName, onOpenCardSheet, isNameSortMode: nameSortMode, sortBy: currentSortBy }) => {
    const original = info.row.original || {};
    const code = original.code;
    const isUpdated = original.isUpdated;
    const hasDca = original.hasDca;
    const hasHoldingAmount = original.holdingAmountValue != null;
    const holdingAmountDisplay = hasHoldingAmount ? (original.holdingAmount ?? '—') : null;
    const isFavorites = favorites?.has?.(code);
    const isGroupTab = isCustomGroupTab;
    const rowSortable = useContext(RowSortableContext);
    const showDragHandle = nameSortMode && currentSortBy === 'default' && rowSortable;
    const bulkSelected = code ? bulkSelectedCodes.has(code) : false;

    if (isBulkDeleteMode) {
      return (
        <div className="name-cell-content" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              width: 26,
              height: 26,
              marginRight: 4,
              cursor: 'pointer',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={bulkSelected}
              onChange={() => {
                if (!code) return;
                setBulkSelectedCodes((prev) => {
                  const next = new Set(prev);
                  if (next.has(code)) next.delete(code);
                  else next.add(code);
                  return next;
                });
              }}
              style={{
                width: 18,
                height: 18,
                accentColor: 'var(--primary)',
                cursor: 'pointer',
              }}
            />
          </label>
          <div className="title-text">
            <span
              className={`name-text ${showFullFundName ? 'show-full' : ''}`}
              title={isUpdated ? '今日净值已更新' : undefined}
            >
              {info.getValue() ?? '—'}
            </span>
            {holdingAmountDisplay ? (
              <span className="muted code-text">
                {masked ? <span className="mask-text">******</span> : holdingAmountDisplay}
                {hasDca && <span className="dca-indicator">定</span>}
                {isUpdated && <span className="updated-indicator">✓</span>}
              </span>
            ) : code ? (
              <span className="muted code-text">
                #{code}
                {hasDca && <span className="dca-indicator">定</span>}
                {isUpdated && <span className="updated-indicator">✓</span>}
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="name-cell-content" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showDragHandle ? (
          <span
            ref={rowSortable.setActivatorNodeRef}
            className="icon-button fav-button"
            title="拖动排序"
            style={{ backgroundColor: 'transparent', touchAction: 'none', cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
            {...rowSortable.listeners}
          >
            <DragIcon width="18" height="18" />
          </span>
        ) : isGroupTab ? (
          <button
            type="button"
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation?.();
              if (refreshing) return;
              onRemoveFundRef.current?.(original);
            }}
            title="删除"
            disabled={refreshing}
            style={{
              backgroundColor: 'transparent',
              flexShrink: 0,
              opacity: refreshing ? 0.55 : 1,
              cursor: refreshing ? 'not-allowed' : 'pointer',
              border: 'none',
              height: 26,
              width: 26,
              marginRight: 4
            }}
          >
            <TrashIcon width="18" height="18" />
          </button>
        ) : (
          <button
            className={`icon-button fav-button ${isFavorites ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation?.();
              onToggleFavoriteRef.current?.(original);
            }}
            title={isFavorites ? '取消自选' : '添加自选'}
            style={{ backgroundColor: 'transparent'}}
          >
            <StarIcon width="18" height="18" filled={isFavorites} />
          </button>
        )}
        <div className="title-text">
          <span
            className={`name-text ${showFullFundName ? 'show-full' : ''}`}
            title={isUpdated ? '今日净值已更新' : onOpenCardSheet ? '点击查看卡片' : ''}
            role={onOpenCardSheet ? 'button' : undefined}
            tabIndex={onOpenCardSheet ? 0 : undefined}
            style={onOpenCardSheet ? { cursor: 'pointer' } : undefined}
            onClick={(e) => {
              if (onOpenCardSheet) {
                e.stopPropagation?.();
                onOpenCardSheet(original);
              }
            }}
            onKeyDown={(e) => {
              if (onOpenCardSheet && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onOpenCardSheet(original);
              }
            }}
          >
            {info.getValue() ?? '—'}
          </span>
          {holdingAmountDisplay ? (
            <span
              className="muted code-text"
              role="button"
              tabIndex={0}
              title="点击设置持仓"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation?.();
                onHoldingAmountClickRef.current?.(original, { hasHolding: true });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onHoldingAmountClickRef.current?.(original, { hasHolding: true });
                }
              }}
            >
              {masked ? <span className="mask-text">******</span> : holdingAmountDisplay}
              {hasDca && <span className="dca-indicator">定</span>}
              {isUpdated && <span className="updated-indicator">✓</span>}
            </span>
          ) : code ? (
            <span
              className="muted code-text"
              role="button"
              tabIndex={0}
              title="设置持仓"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation?.();
                onHoldingAmountClickRef.current?.(original, { hasHolding: false });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onHoldingAmountClickRef.current?.(original, { hasHolding: false });
                }
              }}
            >
              #{code}
              {hasDca && <span className="dca-indicator">定</span>}
              {isUpdated && <span className="updated-indicator">✓</span>}
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: 'fundName',
        header: () => (
          isBulkDeleteMode ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                width: '100%',
                gap: 6,
                flexWrap: 'nowrap',
                minWidth: 0,
              }}
            >
              <button
                type="button"
                className="icon-button"
                disabled={bulkSelectedCodes.size === 0 || refreshing}
                onClick={(e) => {
                  e.stopPropagation?.();
                  if (bulkSelectedCodes.size === 0 || refreshing) return;
                  setBulkDeleteConfirmOpen(true);
                }}
                title="批量删除"
                style={{
                  border: 'none',
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  backgroundColor: 'transparent',
                  color: bulkSelectedCodes.size === 0 || refreshing ? 'var(--muted)' : 'var(--danger)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: bulkSelectedCodes.size === 0 || refreshing ? 0.45 : 1,
                  cursor: bulkSelectedCodes.size === 0 || refreshing ? 'not-allowed' : 'pointer',
                }}
              >
                <TrashIcon width="18" height="18" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={(e) => {
                  e.stopPropagation?.();
                  exitBulkDeleteMode();
                }}
                title="取消"
                aria-label="取消批量删除"
                style={{
                  border: 'none',
                  padding: '0 4px',
                  minHeight: '28px',
                  minWidth: 0,
                  flex: '1 1 0%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  backgroundColor: 'transparent',
                  color: 'var(--text)',
                }}
              >
                <CloseIcon width="20" height="20" />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <button
                type="button"
                className="icon-button"
                onClick={(e) => {
                  e.stopPropagation?.();
                  setSettingModalOpen(true);
                }}
                title="个性化设置"
                style={{
                  border: 'none',
                  width: '28px',
                  height: '28px',
                  minWidth: '28px',
                  backgroundColor: 'transparent',
                  color: 'var(--text)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SettingsIcon width="18" height="18" />
              </button>
              {sortBy === 'default' && (
                <button
                  type="button"
                  className={`icon-button ${isNameSortMode ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation?.();
                    setIsNameSortMode((prev) => {
                      const next = !prev;
                      if (next) {
                        setIsBulkDeleteMode(false);
                        setBulkSelectedCodes(new Set());
                      }
                      return next;
                    });
                  }}
                  title={isNameSortMode ? '退出排序' : '拖动排序'}
                  style={{
                    border: 'none',
                    width: '28px',
                    height: '28px',
                    minWidth: '28px',
                    backgroundColor: 'transparent',
                    color: isNameSortMode ? 'var(--primary)' : 'var(--text)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SortIcon width="18" height="18" />
                </button>
              )}
            </div>
          )
        ),
        cell: (info) => (
          <MobileFundNameCell
            info={info}
            showFullFundName={showFullFundName}
            onOpenCardSheet={getFundCardProps ? (row) => setCardSheetRow(row) : undefined}
            isNameSortMode={isNameSortMode}
            sortBy={sortBy}
          />
        ),
        meta: { align: 'left', cellClassName: 'name-cell', width: columnWidthMap.fundName },
      },
      {
        id: 'relatedSector',
        header: '关联板块',
        cell: (info) => {
          const original = info.row.original || {};
          const code = original.code;
          const value = (code && (relatedSectorByCode?.[code] ?? relatedSectorCacheRef.current.get(code))) || '';
          const display = value || '—';
          const labelKey = value ? String(value).trim() : '';
          const quote = labelKey ? sectorQuoteByLabel?.[labelKey] : null;
          const nameFromQuote = quote?.name != null ? String(quote.name).trim() : '';
          const firstLine = nameFromQuote || display;
          const pct = quote?.pct;
          const pctText = pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : null;
          const pctCls = pct != null ? (pct > 0 ? 'up' : pct < 0 ? 'down' : '') : '';
          return (
            <div
              style={{
                width: '100%',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 2,
              }}
            >
              <span
                title={firstLine !== '—' ? firstLine : undefined}
                style={{
                  display: 'block',
                  width: '100%',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'right',
                  fontSize: '12px',
                }}
              >
                {firstLine}
              </span>
              {pctText != null ? (
                <span
                  className={pctCls}
                  style={{ fontSize: '10px', fontWeight: 600, textAlign: 'right' }}
                >
                  {pctText}
                </span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'related-sector-cell', width: columnWidthMap.relatedSector ?? 120 },
      },
      {
        id: 'period1w',
        header: '近1周',
        cell: (info) => {
          const original = info.row.original || {};
          const code = original.code;
          const value = code ? periodReturnsByCode[code]?.week : null;
          const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
          const text = value != null && Number.isFinite(value)
            ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
            : '—';
          return (
            <div style={{ textAlign: 'right' }}>
              <span className={cls} style={{ fontWeight: 700 }}>{text}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'period-return-cell', width: columnWidthMap.period1w ?? 72 },
      },
      {
        id: 'period1m',
        header: '近1月',
        cell: (info) => {
          const original = info.row.original || {};
          const code = original.code;
          const value = code ? periodReturnsByCode[code]?.month : null;
          const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
          const text = value != null && Number.isFinite(value)
            ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
            : '—';
          return (
            <div style={{ textAlign: 'right' }}>
              <span className={cls} style={{ fontWeight: 700 }}>{text}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'period-return-cell', width: columnWidthMap.period1m ?? 72 },
      },
      {
        id: 'period3m',
        header: '近3月',
        cell: (info) => {
          const original = info.row.original || {};
          const code = original.code;
          const value = code ? periodReturnsByCode[code]?.month3 : null;
          const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
          const text = value != null && Number.isFinite(value)
            ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
            : '—';
          return (
            <div style={{ textAlign: 'right' }}>
              <span className={cls} style={{ fontWeight: 700 }}>{text}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'period-return-cell', width: columnWidthMap.period3m ?? 72 },
      },
      {
        id: 'period6m',
        header: '近6月',
        cell: (info) => {
          const original = info.row.original || {};
          const code = original.code;
          const value = code ? periodReturnsByCode[code]?.month6 : null;
          const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
          const text = value != null && Number.isFinite(value)
            ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
            : '—';
          return (
            <div style={{ textAlign: 'right' }}>
              <span className={cls} style={{ fontWeight: 700 }}>{text}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'period-return-cell', width: columnWidthMap.period6m ?? 72 },
      },
      {
        id: 'period1y',
        header: '近1年',
        cell: (info) => {
          const original = info.row.original || {};
          const code = original.code;
          const value = code ? periodReturnsByCode[code]?.year1 : null;
          const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
          const text = value != null && Number.isFinite(value)
            ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
            : '—';
          return (
            <div style={{ textAlign: 'right' }}>
              <span className={cls} style={{ fontWeight: 700 }}>{text}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'period-return-cell', width: columnWidthMap.period1y ?? 72 },
      },
      {
        accessorKey: 'latestNav',
        header: '最新净值',
        cell: (info) => {
          const original = info.row.original || {};
          const date = original.latestNavDate ?? '-';
          const displayDate = typeof date === 'string' && date.length > 5 ? date.slice(5) : date;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
              <span style={{ display: 'block', width: '100%', fontWeight: 700 }}>
                <FitText maxFontSize={14} minFontSize={10}>
                  {info.getValue() ?? '—'}
                </FitText>
              </span>
              <span className="muted" style={{ fontSize: '10px' }}>{displayDate}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'value-cell', width: columnWidthMap.latestNav },
      },
      {
        accessorKey: 'estimateNav',
        header: '估算净值',
        cell: (info) => {
          const original = info.row.original || {};
          const date = original.estimateNavDate ?? '-';
          const displayDate = typeof date === 'string' && date.length > 5 ? date.slice(5) : date;
          const estimateNav = info.getValue();
          const hasEstimateNav = estimateNav != null && estimateNav !== '—';

          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
              <span style={{ display: 'block', width: '100%', fontWeight: 700 }}>
                <FitText maxFontSize={14} minFontSize={10}>
                  {estimateNav ?? '—'}
                </FitText>
              </span>
              {hasEstimateNav && displayDate && displayDate !== '-' ? (
                <span className="muted" style={{ fontSize: '10px' }}>{displayDate}</span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'value-cell', width: columnWidthMap.estimateNav },
      },
      {
        accessorKey: 'yesterdayChangePercent',
        header: '最新涨幅',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.yesterdayChangeValue;
          const date = original.yesterdayDate ?? '-';
          const displayDate = typeof date === 'string' && date.length > 5 ? date.slice(5) : date;
          const cls = value > 0 ? 'up' : value < 0 ? 'down' : '';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
              <span className={cls} style={{ fontWeight: 700 }}>
                {info.getValue() ?? '—'}
              </span>
              <span className="muted" style={{ fontSize: '10px' }}>{displayDate}</span>
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'change-cell', width: columnWidthMap.yesterdayChangePercent },
      },
      {
        accessorKey: 'estimateChangePercent',
        header: '估算涨幅',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.estimateChangeValue;
          const isMuted = original.estimateChangeMuted;
          const time = original.estimateTime ?? '-';
          const displayTime = typeof time === 'string' && time.length > 5 ? time.slice(5) : time;
          const cls = isMuted ? 'muted' : value > 0 ? 'up' : value < 0 ? 'down' : '';
          const text = info.getValue();
          const hasText = text != null && text !== '—';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
              <span className={cls} style={{ fontWeight: 700 }}>
                {text ?? '—'}
              </span>
              {hasText && displayTime && displayTime !== '-' ? (
                <span className="muted" style={{ fontSize: '10px' }}>{displayTime}</span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'est-change-cell', width: columnWidthMap.estimateChangePercent },
      },
      {
        accessorKey: 'totalChangePercent',
        header: '估算收益',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.estimateProfitValue;
          const hasProfit = value != null;
          const cls = hasProfit ? (value > 0 ? 'up' : value < 0 ? 'down' : '') : 'muted';
          const amountStr = hasProfit ? (original.estimateProfit ?? '') : '—';
          const percentStr = original.estimateProfitPercent ?? '';

          return (
            <div style={{ width: '100%' }}>
              <span className={cls} style={{ display: 'block', width: '100%', fontWeight: 700 }}>
                <FitText maxFontSize={14} minFontSize={10}>
                  {masked && hasProfit ? <span className="mask-text">******</span> : amountStr}
                </FitText>
              </span>
              {hasProfit && percentStr && !masked ? (
                <span className={`${cls} estimate-profit-percent`} style={{ display: 'block', width: '100%', fontSize: '0.75em', opacity: 0.9, fontWeight: 500 }}>
                  <FitText maxFontSize={11} minFontSize={9}>
                    {percentStr}
                  </FitText>
                </span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'total-change-cell', width: columnWidthMap.totalChangePercent },
      },
      {
        accessorKey: 'holdingDays',
        header: '持有天数',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.holdingDaysValue;
          if (value == null) {
            return <div className="muted" style={{ textAlign: 'right', fontSize: '12px' }}>—</div>;
          }
          return (
            <div style={{ fontWeight: 700, textAlign: 'right' }}>
              {value}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'holding-days-cell', width: columnWidthMap.holdingDays ?? 64 },
      },
      {
        accessorKey: 'todayProfit',
        header: '当日收益',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.todayProfitValue;
          const hasProfit = value != null;
          const cls = hasProfit ? (value > 0 ? 'up' : value < 0 ? 'down' : '') : 'muted';
          const amountStr = hasProfit ? (info.getValue() ?? '') : '—';
          const percentStr = original.todayProfitPercent ?? '';
          return (
            <div style={{ width: '100%' }}>
              <span className={cls} style={{ display: 'block', width: '100%', fontWeight: 700 }}>
                <FitText maxFontSize={14} minFontSize={10}>
                  {masked && hasProfit ? <span className="mask-text">******</span> : amountStr}
                </FitText>
              </span>
              {percentStr && !masked ? (
                <span className={`${cls} today-profit-percent`} style={{ display: 'block', width: '100%', fontSize: '0.75em', opacity: 0.9, fontWeight: 500 }}>
                  <FitText maxFontSize={11} minFontSize={9}>
                    {percentStr}
                  </FitText>
                </span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'profit-cell', width: columnWidthMap.todayProfit },
      },
      {
        accessorKey: 'yesterdayProfit',
        header: '昨日收益',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.yesterdayProfitValue;
          const hasProfit = value != null;
          const cls = hasProfit ? (value > 0 ? 'up' : value < 0 ? 'down' : '') : 'muted';
          const amountStr = hasProfit ? (info.getValue() ?? '') : '—';
          const percentStr = original.yesterdayProfitPercent ?? '';
          const pctVal = original.yesterdaySecondLinePctValue;
          const pctCls = pctVal != null && Number.isFinite(pctVal)
            ? (pctVal > 0 ? 'up' : pctVal < 0 ? 'down' : '')
            : 'muted';
          return (
            <div style={{ width: '100%' }}>
              <span className={cls} style={{ display: 'block', width: '100%', fontWeight: 700 }}>
                <FitText maxFontSize={14} minFontSize={10}>
                  {masked && hasProfit ? <span className="mask-text">******</span> : amountStr}
                </FitText>
              </span>
              {percentStr && !masked ? (
                <span className={`${pctCls} yesterday-profit-percent`} style={{ display: 'block', width: '100%', fontSize: '0.75em', opacity: 0.9, fontWeight: 500 }}>
                  <FitText maxFontSize={11} minFontSize={9}>
                    {percentStr}
                  </FitText>
                </span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'yesterday-profit-cell', width: columnWidthMap.yesterdayProfit ?? 80 },
      },
      {
        accessorKey: 'holdingProfit',
        header: '持有收益',
        cell: (info) => {
          const original = info.row.original || {};
          const value = original.holdingProfitValue;
          const hasTotal = value != null;
          const cls = hasTotal ? (value > 0 ? 'up' : value < 0 ? 'down' : '') : 'muted';
          const amountStr = hasTotal ? (info.getValue() ?? '') : '—';
          const percentStr = original.holdingProfitPercent ?? '';
          return (
            <div style={{ width: '100%' }}>
              <span className={cls} style={{ display: 'block', width: '100%', fontWeight: 700 }}>
                <FitText maxFontSize={14} minFontSize={10}>
                  {masked && hasTotal ? <span className="mask-text">******</span> : amountStr}
                </FitText>
              </span>
              {percentStr && !masked ? (
                <span className={`${cls} holding-profit-percent`} style={{ display: 'block', width: '100%', fontSize: '0.75em', opacity: 0.9, fontWeight: 500 }}>
                  <FitText maxFontSize={11} minFontSize={9}>
                    {percentStr}
                  </FitText>
                </span>
              ) : null}
            </div>
          );
        },
        meta: { align: 'right', cellClassName: 'holding-cell', width: columnWidthMap.holdingProfit },
      },
    ],
    [
      currentTab,
      favorites,
      refreshing,
      columnWidthMap,
      showFullFundName,
      getFundCardProps,
      isNameSortMode,
      sortBy,
      relatedSectorByCode,
      sectorQuoteByLabel,
      periodReturnsByCode,
      isBulkDeleteMode,
      bulkSelectedCodes,
      exitBulkDeleteMode,
    ]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      columnOrder: ['fundName', ...mobileColumnOrder],
      columnVisibility: { fundName: true, ...mobileColumnVisibility },
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === 'function' ? updater(['fundName', ...mobileColumnOrder]) : updater;
      const newNonFrozen = next.filter((id) => id !== 'fundName');
      if (newNonFrozen.length) {
        setMobileColumnOrder(newNonFrozen);
      }
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater({ fundName: true, ...mobileColumnVisibility }) : updater;
      const rest = { ...next };
      delete rest.fundName;
      setMobileColumnVisibility(rest);
    },
    initialState: {
      columnPinning: {
        left: ['fundName'],
      },
    },
    defaultColumn: {
      cell: (info) => info.getValue() ?? '—',
    },
  });

  const headerGroup = table.getHeaderGroups()[0];

  const snapPositionsRef = useRef([]);
  const scrollEndTimerRef = useRef(null);

  useEffect(() => {
    if (!headerGroup?.headers?.length) {
      snapPositionsRef.current = [];
      return;
    }
    const gap = 12;
    const widths = headerGroup.headers.map((h) => h.column.columnDef.meta?.width ?? 80);
    if (widths.length > 0) widths[widths.length - 1] += LAST_COLUMN_EXTRA;
    const positions = [0];
    let acc = 0;
    // 从第二列开始累加，因为第一列是固定的，滚动是为了让后续列贴合到第一列右侧
    // 累加的是"被滚出去"的非固定列的宽度
    for (let i = 1; i < widths.length - 1; i++) {
      acc += widths[i] + gap;
      positions.push(acc);
    }
    snapPositionsRef.current = positions;
  }, [headerGroup?.headers?.length, columnWidthMap, mobileColumnOrder]);

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el || snapPositionsRef.current.length === 0) return;

    const snapToNearest = () => {
      const positions = snapPositionsRef.current;
      if (positions.length === 0) return;
      const scrollLeft = el.scrollLeft;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;
      const nearest = positions.reduce((prev, curr) =>
        Math.abs(curr - scrollLeft) < Math.abs(prev - scrollLeft) ? curr : prev
      );
      const clamped = Math.max(0, Math.min(maxScroll, nearest));
      if (Math.abs(clamped - scrollLeft) > 2) {
        el.scrollTo({ left: clamped, behavior: 'smooth' });
      }
    };

    const handleScroll = () => {
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = setTimeout(snapToNearest, 120);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    };
  }, []);

  const mobileGridLayout = (() => {
    if (!headerGroup?.headers?.length) return { gridTemplateColumns: '', minWidth: undefined };
    const gap = 12;
    const widths = headerGroup.headers.map((h) => h.column.columnDef.meta?.width ?? 80);
    if (widths.length > 0) widths[widths.length - 1] += LAST_COLUMN_EXTRA;
    return {
      gridTemplateColumns: widths.map((w) => `${w}px`).join(' '),
      minWidth: widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * gap,
    };
  })();

  const getPinClass = (columnId, isHeader) => {
    if (columnId === 'fundName') {
      const baseClass = isHeader ? 'table-header-cell-pin-left' : 'table-cell-pin-left';
      const scrolledClass = isScrolled ? 'is-scrolled' : '';
      return `${baseClass} ${scrolledClass}`.trim();
    }
    return '';
  };

  const getAlignClass = (columnId) => {
    if (columnId === 'fundName') return '';
    if (['latestNav', 'estimateNav', 'yesterdayChangePercent', 'estimateChangePercent', 'totalChangePercent', 'holdingDays', 'todayProfit', 'yesterdayProfit', 'holdingProfit', 'period1w', 'period1m', 'period3m', 'period6m', 'period1y'].includes(columnId)) return 'text-right';
    return 'text-right';
  };

  const renderTableHeader = ()=>{
    if(!headerGroup) return null;
    return (
      <div
        className="table-header-row mobile-fund-table-header"
        style={mobileGridLayout.gridTemplateColumns ? { gridTemplateColumns: mobileGridLayout.gridTemplateColumns } : undefined}
      >
        {headerGroup.headers.map((header, headerIndex) => {
          const columnId = header.column.id;
          const pinClass = getPinClass(columnId, true);
          const alignClass = getAlignClass(columnId);
          const isLastColumn = headerIndex === headerGroup.headers.length - 1;
          return (
            <div
              key={header.id}
              className={`table-header-cell ${alignClass} ${pinClass}`}
              style={isLastColumn ? { paddingRight: LAST_COLUMN_EXTRA } : undefined}
            >
              {header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          );
        })}
      </div>
    )
  }

  const renderContent = (onlyShowHeader) => {
    if (onlyShowHeader) {
      return (
        <div style={{position: 'fixed', top: effectiveStickyTop}} className="mobile-fund-table mobile-fund-table-portal-header" ref={portalHeaderRef}>
          <div
            className="mobile-fund-table-scroll"
            style={mobileGridLayout.minWidth != null ? { minWidth: mobileGridLayout.minWidth } : undefined}
          >
            {renderTableHeader()}
          </div>
        </div>
      );
    }

    return (
      <div className="mobile-fund-table" ref={tableContainerRef}>
        <div
          className="mobile-fund-table-scroll"
          style={mobileGridLayout.minWidth != null ? { minWidth: mobileGridLayout.minWidth } : undefined}
        >
          {renderTableHeader()}

          {!onlyShowHeader && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext
                items={data.map((item) => item.code)}
                strategy={verticalListSortingStrategy}
              >
                <AnimatePresence mode="popLayout">
                  {table.getRowModel().rows.map((row, index) => (
                    <SortableRow
                      key={row.original.code || row.id}
                      row={row}
                      isTableDragging={!!activeId}
                      disabled={sortBy !== 'default' || isBulkDeleteMode}
                    >
                      {() => (
                        <div
                          className="table-row"
                          style={{
                            background: index % 2 === 0 ? 'var(--bg)' : 'var(--table-row-alt-bg)',
                            position: 'relative',
                            zIndex: 1,
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            WebkitTouchCallout: 'none',
                            touchAction: isBulkDeleteMode ? 'auto' : 'pan-x pan-y',
                            ...(mobileGridLayout.gridTemplateColumns ? { gridTemplateColumns: mobileGridLayout.gridTemplateColumns } : {}),
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          onDragStart={(e) => e.preventDefault()}
                          onClick={() => {
                            if (isBulkDeleteMode) {
                              if (ignoreNextBulkRowClickRef.current) {
                                ignoreNextBulkRowClickRef.current = false;
                                return;
                              }
                              const c = row.original?.code;
                              if (!c) return;
                              setBulkSelectedCodes((prev) => {
                                const next = new Set(prev);
                                if (next.has(c)) next.delete(c);
                                else next.add(c);
                                return next;
                              });
                              return;
                            }
                            if (isNameSortMode) setIsNameSortMode(false);
                          }}
                          onPointerDown={(e) => {
                            if (sortBy !== 'default' || isNameSortMode || isBulkDeleteMode || refreshing) return;
                            if (e.button !== 0 && e.pointerType === 'mouse') return;
                            const c = row.original?.code;
                            if (!c) return;
                            bulkLongPressRef.current.startX = e.clientX;
                            bulkLongPressRef.current.startY = e.clientY;
                            clearBulkLongPressTimer();
                            bulkLongPressRef.current.timer = setTimeout(() => {
                              bulkLongPressRef.current.timer = null;
                              ignoreNextBulkRowClickRef.current = true;
                              try {
                                const sel = typeof window !== 'undefined' && window.getSelection?.();
                                if (sel?.removeAllRanges) sel.removeAllRanges();
                              } catch { /* empty */ }
                              setIsNameSortMode(false);
                              setIsBulkDeleteMode(true);
                              setBulkSelectedCodes(new Set([c]));
                            }, 550);
                          }}
                          onPointerMove={(e) => {
                            if (!bulkLongPressRef.current.timer) return;
                            const dx = Math.abs(e.clientX - bulkLongPressRef.current.startX);
                            const dy = Math.abs(e.clientY - bulkLongPressRef.current.startY);
                            if (dx > 12 || dy > 12) clearBulkLongPressTimer();
                          }}
                          onPointerUp={clearBulkLongPressTimer}
                          onPointerCancel={clearBulkLongPressTimer}
                        >
                          {row.getVisibleCells().map((cell, cellIndex) => {
                            const columnId = cell.column.id;
                            const pinClass = getPinClass(columnId, false);
                            const alignClass = getAlignClass(columnId);
                            const cellClassName = cell.column.columnDef.meta?.cellClassName || '';
                            const isLastColumn = cellIndex === row.getVisibleCells().length - 1;
                            const style = isLastColumn ? {paddingRight: LAST_COLUMN_EXTRA} : {};
                            if (cellIndex  === 0) {
                              if (index % 2 !== 0) {
                                style.background = 'var(--table-row-alt-bg)';
                              }else {
                                style.background = 'var(--bg)';
                              }
                            }
                            return (
                              <div
                                key={cell.id}
                                className={`table-cell ${alignClass} ${cellClassName} ${pinClass}`}
                                style={style}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </SortableRow>
                  ))}
                </AnimatePresence>
              </SortableContext>
            </DndContext>

          )}
        </div>

        {table.getRowModel().rows.length === 0 && !onlyShowHeader && (
          <div className="table-row empty-row">
            <div className="table-cell" style={{ textAlign: 'center' }}>
              <span className="muted">暂无数据</span>
            </div>
          </div>
        )}

        {!onlyShowHeader && (
          <MobileSettingModal
            open={settingModalOpen}
            onClose={() => setSettingModalOpen(false)}
            columns={mobileColumnOrder.map((id) => ({ id, header: MOBILE_COLUMN_HEADERS[id] ?? id }))}
            columnVisibility={mobileColumnVisibility}
            onColumnReorder={(newOrder) => {
              setMobileColumnOrder(newOrder);
            }}
            onToggleColumnVisibility={handleToggleMobileColumnVisibility}
            onResetColumnOrder={handleResetMobileColumnOrder}
            onResetColumnVisibility={handleResetMobileColumnVisibility}
            showFullFundName={showFullFundName}
            onToggleShowFullFundName={handleToggleShowFullFundName}
          />
        )}

        <MobileFundCardDrawer
          open={!!(cardSheetRow && getFundCardProps)}
          onOpenChange={(open) => { if (!open) setCardSheetRow(null); }}
          blockDrawerClose={blockDrawerClose || bulkDeleteConfirmOpen}
          ignoreNextDrawerCloseRef={ignoreNextDrawerCloseRef}
          cardSheetRow={cardSheetRow}
          getFundCardProps={getFundCardProps}
        />

        {!onlyShowHeader && showPortalHeader && ReactDOM.createPortal(renderContent(true), document.body)}

        {!onlyShowHeader && bulkDeleteConfirmOpen && (
          <ConfirmModal
            title="批量删除"
            message={
              isCustomGroupTab
                ? `确定从当前分组中移除已选的 ${bulkSelectedCodes.size} 支基金吗？将清除这些基金在本分组内的持仓与相关记录，不会在「全部」中删除。`
                : `确定删除已选的 ${bulkSelectedCodes.size} 支基金吗？将从列表中移除这些基金及其全部持仓与相关数据。`
            }
            confirmText="确定删除"
            onConfirm={() => {
              const items = Array.from(bulkSelectedCodes)
                .map((code) => {
                  const r = data.find((d) => d.code === code);
                  return r ? { code: r.code, name: r.fundName } : { code };
                })
                .filter((x) => x.code);
              onBulkRemoveFundsConfirmed?.(items);
              exitBulkDeleteMode();
            }}
            onCancel={() => setBulkDeleteConfirmOpen(false)}
          />
        )}
      </div>
    );
  };

  return (
    <>
      {renderContent()}
    </>
  );
}
