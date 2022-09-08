import React, { useState, useEffect } from "react";
import { styled } from "@mui/material/styles";
import {
  Box,
  CardContent,
  Card,
  Button,
  TableHead,
  FormGroup,
  MenuItem,
  Alert,
  Grid,
  Snackbar,
  TextField,
  OutlinedTextFieldProps,
  Stack,
  Tooltip as MuiToolTip,
} from "@mui/material";
import InfoIcon from "@mui/icons-material/Info";
import {
  Duration,
  format as formatDate,
  add as addDate,
  parseISO as parseISODate,
  formatISO,
  formatDuration,
  differenceInSeconds,
  startOfDay,
} from "date-fns";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Legend,
  ArcElement,
  Tooltip,
} from "chart.js";
import Link from "next/link";
import { useSelector } from "react-redux";
import { device } from "../../styles/sizes";
import { Doughnut } from "react-chartjs-2";
import Chart from "react-google-charts";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import { utils, BigNumberish, BigNumber } from "ethers";
import { removeCommaFromString } from "../../utils/helpers";

const linearReleaseOptions: readonly (Duration & {
  label: string;
  value?: number;
})[] = [
  { seconds: 1, label: "Continuous" },
  { minutes: 1, label: "Every Minute" },
  { hours: 1, label: "Hourly" },
  { days: 1, label: "Daily" },
  { weeks: 1, label: "Weekly" },
  { months: 1, label: "Monthly" },
  { years: 1, label: "Yearly" },
];

export type VestingScheduleFormState = {
  recipientType: string;
  startDate: string;
  endDate: string;
  tokenAmount: string;
  cliffDuration: typeof cliffOpts[number] | null;
  cliffPercent: string;
  releaseFrequency: typeof linearReleaseOptions[number] | null;

  // claimTemplateLabel: string | "";
  // isCreateClaimTemplate: boolean;
};

export type ClaimInfo = {
  startTimestamp: number;
  startTimeCliff: number;
  endTimestamp: number;
  cliffReleaseTimestamp: number;
  releaseIntervalSecs: number; // Every how many seconds does the vested amount increase.
  linearVestAmount: string; // total entitlement
  cliffAmount: string; // how much is released at the cliff
  amountWithdrawn: string; // how much was withdrawn thus far
  isActive: boolean; // whether this claim is active (or revoked)
};

export type CalculatedClaimInfo = {
  streamedAmount: string;
  withdrawnAmount: string;
  totalPlannedVestedAmount: string;
  canWithdrawAmount: string;
  fullAmountVestedTimestamp: number;
};

export const dateToAbsoluteTimestampSecs = (dt: Date) =>
  Math.ceil(dt.getTime() / 1000);

export type CalcScheduleParams = {
  linearVestStartTime: Date;
  linearVestStartTimeCliff: Date;
  linearVestEndTime: Date;
  cliffReleaseTime: Date | null;
  releaseInterval: Duration;
  linearVestedAmountTokens: number; // amount in full tokens,not wei
  cliffAmountTokens: number; // amount in full tokens,not wei
  unitDecimals: number;
  tokenPrecision?: number; // Which precision should we use to avoid rounding errors
};

export const calculatePendingClaimInfo = (
  params: CalcScheduleParams
): ClaimInfo => {
  const {
    linearVestStartTime: startTime,
    linearVestStartTimeCliff: startTimeCliff,
    linearVestEndTime: endTime,
    cliffReleaseTime,
    releaseInterval,
    cliffAmountTokens: cliffAmount,
    // cliffDuration = null,
    // releaseFraction,
    linearVestedAmountTokens: totalAmountTokens,
    unitDecimals,
    tokenPrecision = 5,
  } = params;

  const releaseIntervalSecs = dateToAbsoluteTimestampSecs(
    addDate(new Date(0), releaseInterval)
  );

  const claimInfo = {
    startTimestamp: dateToAbsoluteTimestampSecs(startTime),
    startTimeCliff: dateToAbsoluteTimestampSecs(startTimeCliff),
    endTimestamp: dateToAbsoluteTimestampSecs(endTime),
    cliffReleaseTimestamp:
      cliffReleaseTime !== null
        ? dateToAbsoluteTimestampSecs(cliffReleaseTime)
        : 0,
    releaseIntervalSecs, // Every how many seconds does the vested amount increase.
    linearVestAmount: utils
      .parseUnits(totalAmountTokens.toFixed(tokenPrecision), unitDecimals)
      .toString(), // total entitlement
    cliffAmount: utils
      .parseUnits(cliffAmount.toFixed(tokenPrecision), unitDecimals)
      .toString(), // how much is released at the cliff,
    amountWithdrawn: BigNumber.from(0).toString(),
    isActive: true,
  }; // as AddVestingClaimDto;

  return claimInfo;
};

const cliffOpts: readonly Duration[] = [
  { months: 1 },
  { months: 3 },
  { months: 6 },
  { years: 1 },
  { months: 18 },
  { years: 2 },
];

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip
);

ChartJS.register(ArcElement, Tooltip);

const recipients = [
  { value: 1, label: "Advisor" },
  { value: 2, label: "Founder" },
  { value: 3, label: "Investor" },
  { value: 4, label: "Team member" },
];

const frequencies = [
  { value: 1, label: "Continuous" },
  { value: 2, label: "Every minute" },
  { value: 3, label: "Hourly" },
  { value: 4, label: "Daily" },
  { value: 5, label: "Weekly" },
  { value: 6, label: "Monthly" },
  { value: 7, label: "Yearly" },
];

export default function Vesting() {
  const [notificationText, setNotificationText] = useState<string | null>(null);
  const [tentativeDatePossibilities, setTentativeDatePossibilities] = useState<
    Date[]
  >([]);
  const [formState, setFormState] = useState<VestingScheduleFormState>({
    recipientType: "",
    tokenAmount: "",
    startDate: "",
    endDate: "",
    cliffDuration: null,
    cliffPercent: "",
    releaseFrequency: null,
  });
  const [formFieldErrors, setFormFieldErrors] = useState<
    Partial<{ [k in keyof VestingScheduleFormState | "general"]: string }>
  >({});
  const [pendingClaimInfo, setPendingClaimInfo] = useState<ClaimInfo>({
    startTimestamp: 0,
    startTimeCliff: 0,
    endTimestamp: 0,
    cliffReleaseTimestamp: 0,
    releaseIntervalSecs: 0,
    linearVestAmount: "0",
    cliffAmount: "0",
    amountWithdrawn: "",
    isActive: true,
  });
  const [isSteppedChart, setIsSteppedChart] = useState(false);
  const [areaData, setAreaData] = useState<any>([]);

  const parseFormDate = (dateStr: string) => {
    return parseISODate(dateStr);
  };

  const getLinearVestStartDate = () => {
    const scheduleStartDate = parseFormDate(formState.startDate);
    return scheduleStartDate;
  };

  const getLinearVestCliffDate = () => {
    const scheduleStartDate = parseFormDate(formState.startDate);
    return formState.cliffDuration
      ? addDate(scheduleStartDate, formState.cliffDuration)
      : scheduleStartDate;
  };

  const formatTokenAmount = (
    amount: BigNumberish,
    options: { showSymbol?: boolean; outputDecimals?: number } = {}
  ) => {
    // const decimals = tokenMeta?.decimals ?? 0;
    const { outputDecimals = 2, showSymbol = true } = options;
    const value = utils.formatUnits(amount, 18);
    const fmtVal = parseFloat(value).toFixed(outputDecimals);
    return showSymbol ? `${fmtVal}` : fmtVal;
  };

  const startAmt = +formatTokenAmount(pendingClaimInfo.cliffAmount, {
    showSymbol: false,
    outputDecimals: 2,
  });
  const endAmt = +formatTokenAmount(
    BigNumber.from(pendingClaimInfo.linearVestAmount)
      .add(pendingClaimInfo.cliffAmount)
      .toString(),
    { showSymbol: false, outputDecimals: 2 }
  );

  const DATE_FORMAT = "MMM dd, yyyy";
  const TIME_FORMAT = "HH:mm";
  const DATETIME_FORMAT = `${DATE_FORMAT} ${TIME_FORMAT}`;
  const DATETIME_S_FORMAT = `${DATE_FORMAT} ${TIME_FORMAT}:ss`;

  function createData(
    name: string,
    calories: number,
    fat: number,
    carbs: number,
    protein: number
  ) {
    return { name, calories, fat, carbs, protein };
  }
  const rows = [
    createData("Frozen yoghurt", 159, 6.0, 24, 4.0),
    createData("Ice cream sandwich", 237, 9.0, 37, 4.3),
    createData("Eclair", 262, 16.0, 24, 6.0),
    createData("Cupcake", 305, 3.7, 67, 4.3),
    createData("Gingerbread", 356, 16.0, 49, 3.9),
  ];

  const changeChartType = () => {
    if (
      formState.releaseFrequency?.value &&
      formState.releaseFrequency.value >= 4
    ) {
      setIsSteppedChart(true);
      let AreaDataTemp = [
        ["x", "Amount"],
        [
          new Date(
            formatDate(
              pendingClaimInfo.startTimestamp * 1000,
              DATETIME_FORMAT
            ).slice(0, -6)
          ),
          0,
        ],
        [
          new Date(
            formatDate(
              pendingClaimInfo.startTimeCliff * 1000,
              DATETIME_FORMAT
            ).slice(0, -6)
          ),
          0,
        ],
      ];

      let freq = 1;
      switch (formState.releaseFrequency.value) {
        case 4:
          freq = 1;
          break;
        case 5:
          freq = 7;
          break;
        case 6:
          freq = 30;
          break;
        case 7:
          freq = 365;
          break;
        default:
          break;
      }

      let ValueLength =
        (pendingClaimInfo.endTimestamp - pendingClaimInfo.startTimeCliff) /
        (86400 * freq);

      for (let i = 0; i < ValueLength; i++) {
        const temp = [
          new Date(
            formatDate(
              (pendingClaimInfo.startTimeCliff + 86400 * freq * i) * 1000,
              DATETIME_FORMAT
            ).slice(0, -6)
          ),
          getTokenAmount(startAmt + ((endAmt - startAmt) / ValueLength) * i),
        ];
        AreaDataTemp.push(temp);
      }

      setAreaData(AreaDataTemp);
    } else {
      setIsSteppedChart(false);
    }
  };

  const updateFormState = (name: string, value: string) => {
    let newValue;
    const otherAssignments: Partial<VestingScheduleFormState> = {};
    switch (name) {
      case "tokenAmount":
        newValue = value;
        let str = value
          .toString()
          .replaceAll(",", "")
          .replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
        if (
          removeCommaFromString(value).toString()[0] === "0" &&
          removeCommaFromString(value).toString().length > 0
        )
          str = str.substring(1);
        if (/^\d*$/.test(removeCommaFromString(value))) newValue = str;
        else newValue = str.slice(0, value.length - 1);
        break;
      case "releaseFrequency":
        newValue = JSON.parse(value);
        if (!newValue) {
          otherAssignments.endDate = "";
        }
        break;
      case "cliffDuration":
        newValue = JSON.parse(value);
        break;
      case "cliffPercent":
        if (parseFloat(value.replaceAll("%", "")) < 100)
          newValue = `${value.replaceAll("%", "")}%`;
        else newValue = "";
        break;
      case "startDate":
      case "endDate":
        const dt = parseISODate(value);
        try {
          newValue = formatISO(dt);
        } catch (e: any) {
          newValue = "";
        }
        break;
      // Everything else will be parsed int he validation fn
      default:
        newValue = value;
        break;
    }
    const newState = { ...formState, [name]: newValue };
    setFormState(newState);
  };

  const updateChart = () => {
    const totalAmountTokensMulE5 =
      100000 * parseFloat(formState.tokenAmount.replaceAll(",", ""));
    const cliffAmountTokensMulE5 = formState.cliffDuration
      ? Math.floor(
          totalAmountTokensMulE5 * parseFloat(formState.cliffPercent) * 0.01
        )
      : 0;
    const linearVestedAmountTokensMulE5 =
      totalAmountTokensMulE5 - cliffAmountTokensMulE5;

    // Just in case - go back to dividing by 10e5
    const cliffAmountTokens = +(cliffAmountTokensMulE5 * 0.00001).toFixed(5);
    const linearVestedAmountTokens = +(
      linearVestedAmountTokensMulE5 * 0.00001
    ).toFixed(5);

    // Parse/process this
    const scheduleStartDate = parseFormDate(formState.startDate);
    // const scheduleEndDate = addDate(parseFormDate(formState.scheduleEndDate), {seconds: 6});
    const scheduleEndDate = parseFormDate(formState.endDate);
    const linearVestStartTimeCliff = getLinearVestCliffDate();
    const linearVestStartTime = getLinearVestStartDate();
    let linearVestEndTime = scheduleEndDate;

    if (!isNaN(scheduleStartDate.getTime()) && formState.releaseFrequency) {
      const pendingClaimInfo = calculatePendingClaimInfo({
        linearVestStartTime,
        linearVestStartTimeCliff,
        linearVestEndTime,
        cliffReleaseTime: cliffAmountTokens > 0 ? linearVestStartTime : null, // cliff time and linear start are at the same moment
        releaseInterval: formState.releaseFrequency,
        linearVestedAmountTokens,
        cliffAmountTokens,
        unitDecimals: 18,
      });
      setPendingClaimInfo(pendingClaimInfo);
    }
  };

  const fieldProps = (
    name: keyof VestingScheduleFormState
  ): OutlinedTextFieldProps => ({
    size: "small",
    fullWidth: true,
    onChange: (e: any) => updateFormState(name, e.target.value),
    value: formState[name] ?? "",
    variant: "outlined",
    error: !!(formFieldErrors?.[name] ?? false),
    helperText: formFieldErrors[name] ?? "",
  });

  const validateSchedule = () => {
    const errors: typeof formFieldErrors = {};

    // Do the calculations multiplied by 100000
    // We might want to switch to bignumbers right here, but the input can be decimal on the user's side
    const totalAmountTokensMulE5 =
      100000 * parseFloat(formState.tokenAmount.replaceAll(",", ""));
    // Cliff amount is 0 if we have no cliff selected
    const cliffAmountTokensMulE5 = formState.cliffDuration
      ? Math.floor(
          totalAmountTokensMulE5 * parseFloat(formState.cliffPercent) * 0.01
        )
      : 0;

    // Just in case - go back to dividing by 10e5

    // Parse/process this
    const scheduleStartDate = parseFormDate(formState.startDate);
    // const scheduleEndDate = addDate(parseFormDate(formState.scheduleEndDate), {seconds: 6});
    const scheduleEndDate = parseFormDate(formState.endDate);

    if (isNaN(scheduleStartDate.getTime())) {
      errors.startDate = "Start date must be set.";
    }

    if (!formState.releaseFrequency) {
      errors.releaseFrequency = "Release frequency must be set.";
    } else if (!scheduleEndDate) {
      // Don't error on endDate if already errored on linearReleaseFrequency
      errors.endDate = "End date must be set.";
    }

    if (!(totalAmountTokensMulE5 > 0)) {
      errors.tokenAmount = "Tokens must be assigned to the schedule.";
    } else if (
      (parseFloat(formState.tokenAmount.replaceAll(",", "")) * 1000) % 1 >
      0.000001
    ) {
      errors.tokenAmount = "Amount can't have more than three decimal places.";
    }

    if (formState.cliffDuration) {
      if (!(cliffAmountTokensMulE5 > 0)) {
        errors.cliffPercent = "If using cliff, cliff percent must be set.";
      } else if ((parseFloat(formState.cliffPercent) * 100) % 1 > 0.000001) {
        errors.cliffPercent = "Cliff cannot more than two decimal places.";
      } else if (parseFloat(formState.cliffPercent) >= 100) {
        errors.cliffPercent = "Cliff cannot be more than 100%.";
      }
    }

    // TS prerequisite for everything that follows (should be error handled above )
    if (!isNaN(scheduleStartDate.getTime()) && formState.releaseFrequency) {
      const linearVestStartTimeCliff = getLinearVestCliffDate();
      let linearVestEndTime = scheduleEndDate;

      // Distinguish the casese where we're before or after the linear vest star time
      if (scheduleEndDate < linearVestStartTimeCliff) {
        errors.endDate =
          errors.startDate = `Linear vesting end date must be after the start date. Linear vesting starts at ${formatDate(
            linearVestStartTimeCliff,
            DATETIME_S_FORMAT
          )} because of the cliff.`;
      } else if (scheduleEndDate < scheduleStartDate) {
        errors.endDate = errors.startDate =
          "End date must be after the start date.";
      }

      if (
        linearVestStartTimeCliff &&
        linearVestEndTime &&
        formState.releaseFrequency
      ) {
        // How many times does the release interval fit into the whole date interval
        // Must be a whole number, otherwise we get undefined behaviour
        const lengthReleaseIntervalSecs = differenceInSeconds(
          addDate(linearVestStartTimeCliff, formState.releaseFrequency),
          linearVestStartTimeCliff
        );
        const numReleaseIntervalMultiples = Math.abs(
          differenceInSeconds(linearVestEndTime, linearVestStartTimeCliff) /
            lengthReleaseIntervalSecs
        );
        const releaseIntervalDecimalPart = numReleaseIntervalMultiples % 1;

        const closestMatchMult = Math.max(
          Math.round(numReleaseIntervalMultiples),
          1
        ); // cant  go lower than 1
        const tentativeEndDate = addDate(linearVestStartTimeCliff, {
          seconds: closestMatchMult * lengthReleaseIntervalSecs,
        });

        // If the tentative and actually selected date are very close together (30 seconds), just use the tentative date
        if (
          scheduleEndDate > linearVestStartTimeCliff &&
          (releaseIntervalDecimalPart < 0.0001 ||
            lengthReleaseIntervalSecs * releaseIntervalDecimalPart < 100)
        ) {
          // In this case, just use the tentative assuming it's close enough
          linearVestEndTime = tentativeEndDate;
        }
      }

      if (isNaN(scheduleEndDate.getTime())) {
        errors.endDate = "Invalid end date.";
      }
      try {
        if (Object.keys(errors).length === 0) {
          updateChart();
        }
      } catch (e: any) {
        errors.general = e.message;
      }
    }
    setFormFieldErrors(errors);
  };

  useEffect(() => {
    if (formState.startDate != "") {
      validateSchedule();
    }
  }, [formState]);

  useEffect(() => {
    changeChartType();
  }, [pendingClaimInfo]);

  const scheduleFractionMsecs: number =
    (pendingClaimInfo.endTimestamp - pendingClaimInfo.startTimestamp) * 50;
  const startDt: any =
    formState.startDate && parseFormDate(formState.startDate);
  const endDt = formState.endDate && parseFormDate(formState.endDate);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Snackbar
        open={notificationText !== null}
        onClose={() => {
          setNotificationText(null);
        }}
        autoHideDuration={5000}
      >
        <Alert severity={"info"}>{notificationText}</Alert>
      </Snackbar>
      <Section>
        <Grid container spacing={2}>
          <Grid
            item
            md={4}
            xs={12}
            display="flex"
            justifyContent={"center"}
            alignItems={"flex-start"}
            flexDirection="column"
          >
            <BackBtnArea>
              <Link href="/">
                <BackButton>
                  <img src="images/new/arrow.png" alt="unlock" />
                </BackButton>
              </Link>
              <BlockTitle>Create vesting schedule</BlockTitle>
            </BackBtnArea>
            <Card style={{ width: "100%", borderRadius: "20px" }}>
              <CardContent>
                <StyledFormGroup>
                  <p>Recipient type</p>
                  <DropdownField select {...fieldProps("recipientType")}>
                    {/* <DropdownField select value={formState.recipientType} onChange={(e) => updateFormState('recipientType', e.target.value)}> */}
                    {recipients.map((item: any, i: number) => (
                      <StyledMenuItem key={i} value={item.label}>
                        {item.label}
                      </StyledMenuItem>
                    ))}
                  </DropdownField>
                </StyledFormGroup>

                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <StyledFormGroup>
                      <p>Schedule start date</p>
                      <DateWrapper>
                        <DisplayDateArea>
                          <StartDateDisplay>
                            {startDt
                              ? formatDate(startDt, DATE_FORMAT)
                              : "Select date"}
                          </StartDateDisplay>
                        </DisplayDateArea>
                      </DateWrapper>
                      <StyledDateField
                        type="date"
                        InputLabelProps={{ shrink: true }}
                        {...fieldProps("startDate")}
                        value={startDt && formatDate(startDt, DATE_FORMAT)}
                      />
                    </StyledFormGroup>
                  </Grid>
                  <Grid item xs={6}>
                    <StyledFormGroup>
                      <p>Schedule end date</p>
                      <DateWrapper>
                        <DisplayDateArea>
                          <StartDateDisplay>
                            {endDt
                              ? formatDate(endDt, DATE_FORMAT)
                              : "Select date"}
                          </StartDateDisplay>
                        </DisplayDateArea>
                      </DateWrapper>
                      <StyledDateField
                        type="date"
                        InputLabelProps={{ shrink: true }}
                        {...fieldProps("endDate")}
                        value={endDt && formatDate(endDt, DATE_FORMAT)}
                      />
                    </StyledFormGroup>
                  </Grid>
                </Grid>

                <StyledFormGroup>
                  <p>Token amount</p>
                  <StyledTextField
                    InputLabelProps={{ shrink: true }}
                    {...fieldProps("tokenAmount")}
                  />
                </StyledFormGroup>

                <StyledFormGroup>
                  <p>Cliff duration after schedule start</p>
                  <DropdownField
                    select
                    {...fieldProps("cliffDuration")}
                    value={JSON.stringify(formState.cliffDuration)}
                  >
                    <StyledMenuItem value={"null"}>No Cliff</StyledMenuItem>
                    {cliffOpts.map((cliffOpt, i) => (
                      <StyledMenuItem key={i} value={JSON.stringify(cliffOpt)}>
                        {formatDuration(cliffOpt)}
                      </StyledMenuItem>
                    ))}
                  </DropdownField>
                </StyledFormGroup>

                <StyledFormGroup>
                  <p>Lump sump release after cliff (0-99%)</p>
                  <StyledTextField
                    InputLabelProps={{ shrink: true }}
                    {...fieldProps("cliffPercent")}
                    disabled={formState.cliffDuration === null}
                  />
                </StyledFormGroup>

                <StyledFormGroup>
                  <p>Linear release frequency</p>
                  <DropdownField
                    select
                    {...fieldProps("releaseFrequency")}
                    value={JSON.stringify(formState.releaseFrequency) ?? ""}
                  >
                    {frequencies.map((frequency, i) => (
                      <StyledMenuItem key={i} value={JSON.stringify(frequency)}>
                        {frequency.label}
                      </StyledMenuItem>
                    ))}
                  </DropdownField>
                </StyledFormGroup>
              </CardContent>
            </Card>
          </Grid>
          <Grid item md={8} xs={12} textAlign="left">
            <BlockTitle>Schedule details</BlockTitle>
            <ScheduleDetailCard>
              <ColumnArea>
                <StartDateDisplay>Cliff Period</StartDateDisplay>
                <WrapperIcon>
                  <Iconimage src="images/new/icon_clfif.svg" />
                  <StartDateDisplay cl="#8f8f8f">
                    {formState.cliffDuration
                      ? formatDuration(formState.cliffDuration)
                      : "No cliff"}
                  </StartDateDisplay>
                </WrapperIcon>
              </ColumnArea>
              <ColumnArea>
                <StartDateDisplay>Schedule start</StartDateDisplay>
                <WrapperIcon>
                  <Iconimage src="images/new/icon_date.svg" />
                  <StartDateDisplay cl="#8f8f8f">
                    {startDt ? formatDate(startDt, DATE_FORMAT) : "Select date"}
                  </StartDateDisplay>
                </WrapperIcon>
              </ColumnArea>
              <ColumnArea>
                <StartDateDisplay>Schedule end</StartDateDisplay>
                <WrapperIcon>
                  <Iconimage src="images/new/icon_date.svg" />
                  <StartDateDisplay cl="#8f8f8f">
                    {endDt ? formatDate(endDt, DATE_FORMAT) : "Select date"}
                  </StartDateDisplay>
                </WrapperIcon>
              </ColumnArea>
              <ColumnArea>
                <StartDateDisplay>Release</StartDateDisplay>
                <WrapperIcon>
                  <Iconimage src="images/new/icon_linear.svg" />
                  <StartDateDisplay cl="#8f8f8f">
                    {formState["cliffPercent"].replaceAll("%", "") !== ""
                      ? formState["cliffPercent"].replaceAll("%", "")
                      : "0"}
                    %
                  </StartDateDisplay>
                </WrapperIcon>
              </ColumnArea>
              <ColumnArea>
                <StartDateDisplay>Total Amount</StartDateDisplay>
                <WrapperIcon>
                  <Iconimage src="images/new/icon_token.svg" />
                  <StartDateDisplay cl="#8f8f8f">
                    {formState["tokenAmount"] !== ""
                      ? formState["tokenAmount"]
                      : "0"}
                  </StartDateDisplay>
                </WrapperIcon>
              </ColumnArea>
            </ScheduleDetailCard>
            <Card
              style={{ width: "100%", height: "370px", borderRadius: "20px" }}
            >
              {/* <Line data={data} options={options} /> */}
              <Chart
                width="100%"
                height="360px"
                chartType={!isSteppedChart ? "AreaChart" : "SteppedAreaChart"}
                loader={<div>Loading Chart</div>}
                data={isSteppedChart ? areaData : LineData}
                options={LineChartOptions}
                rootProps={{ "data-testid": "2" }}
                legendToggle
              />
            </Card>
          </Grid>
          <BlockTitle style={{ margin: "1em 0.5em" }}>Cap table</BlockTitle>
          <Grid container spacing={5}>
            <CapTableGrid item md={4} xs={12}>
              <div style={{ width: "65%", margin: "0 auto" }}>
                <Doughnut
                  data={DoughnutData}
                  width={"700px"}
                  height={"700px"}
                />
              </div>
            </CapTableGrid>
          </Grid>
        </Grid>
      </Section>
    </Box>
  );
}

const Section = styled("section")`
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 6px;
  @media ${device.laptopL} {
    padding: 20px 70px;
    text-align: center;
  }
  @media ${device.laptop} {
    padding: 20px 70px;
    text-align: center;
  }
`;
const StyledFormGroup = styled(FormGroup)`
  align-items: flex-start;
  margin-bottom: 6px;
  p {
    margin-top: 5.5px;
    font-family: "Inter";
    font-size: 12px;
    font-weight: normal;
    font-stretch: normal;
    font-style: normal;
    line-height: normal;
    letter-spacing: normal;
  }
  input {
    font-size: 14px;
  }
`;
const StyledMenuItem = styled(MenuItem)`
  font-size: 14px;
`;
const StyledButton = styled(Button)`
  background-color: #1b369a !important;
  height: 40px;
  width: 270px;
  position: absolute;
  top: 40%;
  left: 35%;
  z-index: 999;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  p {
    font-size: 14px;
    font-weight: 500;
    text-transform: none;
    color: white;
  }
  img {
    width: 24px;
    height: 24px;
  }
`;
const BackButton = styled("div")`
  background-color: #1b369a;
  height: 30px;
  width: 30px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  &:hover {
    opacity: 0.7;
    background-color: #1b369a;
    cursor: pointer;
  }
  img {
    width: 12px;
    height: 12px;
    transform: rotate(180deg);
  }
`;
const CapTableGrid = styled(Grid)`
  filter: blur(6px);
  cursor: not-allowed;
`;
const BlurArea = styled("div")`
  position: relative;
  display: flex;
  width: 100%;
`;
const DropdownField = styled(TextField)`
  text-align: left;
  div {
    border-radius: 16px;
    height: 32px;
    font-size: 14px;
  }
`;
const tableStyles = {
  filter: "blur(6px)",
  cursor: "not-allowed",
  borderRadius: "20px",
};
const BlockTitle = styled("p")`
  font-size: 24px;
  font-weight: 500;
  margin: 0;
  font-family: "Inter";
`;
const SubTitle = styled("div")`
  display: flex;
  align-items: center;
  div {
    width: 20px;
    height: 20px;
    flex-grow: 0;
    padding: 2px;
    border-radius: 100px;
    background-color: #673a58;
    color: white;
    font-size: 12px;
    margin-right: 0.5em;
  }
  p {
    font-family: "Inter";
    font-size: 12px;
    font-weight: normal;
    font-stretch: normal;
    font-style: normal;
    line-height: normal;
    letter-spacing: normal;
    text-align: left;
  }
`;
const StyledTextField = styled(TextField)`
  div {
    height: 32px;
    border-radius: 16px;
  }
`;
const StyledDateField = styled(StyledTextField)`
  margin-top: -32px;
  padding-right: 0 !important;
  div {
    border-radius: 16px;
  }
`;
const DateWrapper = styled("div")`
  position: relative;
  width: 100%;
  height: 32px;
`;
const DisplayDateArea = styled("div")`
  position: absolute;
  left: 2px;
  top: 2px;
  width: 72%;
  min-width: 90px;
  height: 28px;
  border-radius: 14px;
  border: none;
  background-color: white;
  z-index: 10;
  padding-left: 0.5em;
  p {
    @media (max-width: 500px) {
      font-size: 12px !important;
    }
  }
`;
const StartDateDisplay = styled("p")<{ cl?: string }>`
  font-family: "Inter";
  font-size: 14px !important;
  font-weight: normal;
  font-stretch: normal;
  font-style: normal;
  line-height: normal;
  letter-spacing: normal;
  text-align: left;
  color: ${(props) => (props.cl ? props.cl : "#000")};
`;
const ColumnArea = styled("div")`
  display: flex;
  flex-direction: column;
  margin: 0.5em;
  p {
    margin: 2px;
  }
`;
const ScheduleDetailCard = styled(Card)`
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 0.5em;
  margin-bottom: 18px;
  height: 73px;
  border-radius: 20px;
`;

const WrapperIcon = styled("div")`
  display: flex;
  flex-direction: row;
  justify-content: space-around;
`;

const Iconimage = styled("img")`
  width: 20px;
`;
const BackBtnArea = styled("div")`
  display: flex;
  align-items: center;
`;
